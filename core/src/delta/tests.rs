use super::*;
use crate::blocks::AIR;

fn filled(block: u8) -> Vec<u8> {
    vec![block; CELLS]
}

/// A chunk with no two neighbouring cells alike, so runs cannot shrink it.
fn noise() -> Vec<u8> {
    (0..CELLS).map(|i| (i * 5 % 15) as u8 + 1).collect()
}

/// A small deterministic generator, so a failing case can be replayed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

#[test]
fn a_chunk_nobody_changed_is_an_empty_sparse_value() {
    let chunk = noise();
    let value = encode(1, &chunk, &chunk);
    assert_eq!(value, [1, 1, 0, 0]);
    assert_eq!(apply(&value, 1, &chunk).unwrap(), chunk);
}

#[test]
fn the_sparse_layout_is_fixed() {
    let generated = filled(3);
    let mut current = generated.clone();
    current[5] = AIR;
    current[0x0123] = 9;
    // format 1, version 7, two changes; cell 5 is air, cell 0x123 is block 9.
    assert_eq!(
        encode(7, &generated, &current),
        [1, 7, 2, 0, 5, 0, 0, 0x23, 0x01, 9]
    );
}

#[test]
fn the_dense_layout_is_fixed() {
    let mut current = filled(8);
    current[..3].copy_from_slice(&[1, 2, 3]);
    let dense = encode_dense(2, &current);
    // Literal group of 3 (control 2), then 4,093 of block 8: 31 full runs of 129 (control 255) and one of 94.
    let mut want = vec![2, 2, 2, 1, 2, 3];
    for _ in 0..31 {
        want.extend([255, 8]);
    }
    want.extend([94 + 126, 8]);
    assert_eq!(dense, want);
    assert_eq!(apply(&dense, 1, &filled(0)).unwrap(), current);
}

#[test]
fn a_few_edits_stay_sparse_at_three_bytes_a_cell() {
    let generated = noise();
    let mut current = generated.clone();
    for i in (0..300).map(|i| i * 13) {
        current[i] = 0;
    }
    let value = encode(1, &generated, &current);
    assert_eq!(value[0], SPARSE);
    assert_eq!(value.len(), 4 + 3 * 300);
    assert_eq!(apply(&value, 1, &generated).unwrap(), current);
}

#[test]
fn a_rebuilt_chunk_is_dense_and_small() {
    let generated = noise();
    let current = filled(9);
    let value = encode(1, &generated, &current);
    assert_eq!(value[0], DENSE);
    assert_eq!(value.len(), 2 + 2 * 32);
    // A dense value is the whole chunk, so it reads the same over any generated chunk.
    assert_eq!(apply(&value, 1, &generated).unwrap(), current);
    assert_eq!(apply(&value, 1, &filled(0)).unwrap(), current);
}

/// Cells that cannot be run-length encoded cost 4,130 bytes dense, so sparse wins up to 1,375 changed cells.
#[test]
fn the_switch_happens_where_the_two_sizes_cross() {
    let current = noise();
    let with_changes = |n: usize| {
        let mut generated = current.clone();
        generated[..n].fill(0);
        encode(1, &generated, &current)
    };
    let last_sparse = with_changes(1375);
    assert_eq!((last_sparse[0], last_sparse.len()), (SPARSE, 4129));
    let first_dense = with_changes(1376);
    assert_eq!((first_dense[0], first_dense.len()), (DENSE, 4130));
}

#[test]
fn no_value_is_longer_than_the_worst_case() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for _ in 0..20 {
        let generated: Vec<u8> = (0..CELLS).map(|_| (rng.next() % 16) as u8).collect();
        let current: Vec<u8> = (0..CELLS).map(|_| (rng.next() % 16) as u8).collect();
        let value = encode(1, &generated, &current);
        assert!(value.len() <= 4130, "{} bytes", value.len());
        assert_eq!(apply(&value, 1, &generated).unwrap(), current);
    }
}

/// Short runs between literals save nothing, so they must not be split out: that would pass the worst case.
#[test]
fn short_runs_never_make_a_value_longer_than_literals_would() {
    for run in 1..9 {
        let current: Vec<u8> = (0..CELLS).map(|i| 1 + (i / run % 2) as u8).collect();
        let value = encode(1, &filled(0), &current);
        assert!(value.len() <= 4130, "runs of {run}: {} bytes", value.len());
        assert_eq!(apply(&value, 1, &filled(0)).unwrap(), current);
    }
}

#[test]
fn edits_of_every_size_read_back() {
    let mut rng = Rng(42);
    for round in 0..200 {
        let generated: Vec<u8> = (0..CELLS).map(|i| (i / 300 % 4) as u8 + 1).collect();
        let mut current = generated.clone();
        // From a handful of cells to nearly all, plus some rounds of long runs.
        let edits = [3, 40, 400, 1500, 3000, 4096][round % 6];
        for _ in 0..edits {
            let at = (rng.next() % CELLS as u64) as usize;
            let len = if round % 2 == 0 {
                1
            } else {
                1 + (rng.next() % 200) as usize
            };
            let block = (rng.next() % 16) as u8;
            let end = (at + len).min(CELLS);
            current[at..end].fill(block);
        }
        let value = encode(3, &generated, &current);
        assert_eq!(generator_version(&value), Ok(3));
        assert_eq!(
            apply(&value, 3, &generated).unwrap(),
            current,
            "round {round}"
        );
    }
}

#[test]
fn runs_and_literals_split_at_their_longest() {
    for len in [1, 2, 127, 128, 129, 130, 257, 258, 259] {
        for edge in [0, CELLS - len] {
            let mut current = filled(4);
            // Alternating blocks around a stretch of one block, so both literals and runs are long.
            for (i, b) in current.iter_mut().enumerate() {
                *b = 1 + (i % 2) as u8;
            }
            current[edge..edge + len].fill(9);
            let dense = encode_dense(1, &current);
            assert_eq!(
                apply(&dense, 1, &filled(0)).unwrap(),
                current,
                "run {len} at {edge}"
            );
        }
    }
}

#[test]
fn a_value_that_is_cut_or_broken_is_refused() {
    let base = filled(3);
    let at = |value: &[u8]| apply(value, 1, &base);
    assert_eq!(at(&[]), Err(DecodeError::Truncated));
    assert_eq!(at(&[1]), Err(DecodeError::Truncated));
    assert_eq!(at(&[0, 1, 0, 0]), Err(DecodeError::UnknownFormat(0)));
    assert_eq!(at(&[3, 1, 0, 0]), Err(DecodeError::UnknownFormat(3)));
    assert_eq!(
        generator_version(&[9, 1]),
        Err(DecodeError::UnknownFormat(9))
    );
    // Sparse.
    assert_eq!(at(&[1, 1]), Err(DecodeError::Truncated));
    assert_eq!(at(&[1, 1, 2, 0, 0, 0, 5]), Err(DecodeError::Truncated));
    assert_eq!(at(&[1, 1, 0, 0, 0]), Err(DecodeError::TrailingBytes));
    assert_eq!(
        at(&[1, 1, 1, 0, 0, 0x10, 5]),
        Err(DecodeError::CellOutOfRange)
    );
    assert_eq!(
        at(&[1, 1, 2, 0, 9, 0, 5, 9, 0, 6]),
        Err(DecodeError::CellsNotAscending)
    );
    assert_eq!(
        at(&[1, 1, 2, 0, 9, 0, 5, 3, 0, 6]),
        Err(DecodeError::CellsNotAscending)
    );
    assert_eq!(at(&[1, 1, 1, 0, 0, 0, 255]), Err(DecodeError::NotABlock));
    // Dense.
    assert_eq!(at(&[2, 1]), Err(DecodeError::WrongLength));
    assert_eq!(at(&[2, 1, 3, 1, 2]), Err(DecodeError::Truncated));
    assert_eq!(at(&[2, 1, 200]), Err(DecodeError::Truncated));
    let mut long = vec![2, 1];
    for _ in 0..32 {
        long.extend([255, 4]);
    }
    assert_eq!(at(&long), Err(DecodeError::WrongLength));
    long.truncate(2 + 2 * 31);
    assert_eq!(at(&long), Err(DecodeError::WrongLength));
    let mut unloaded = vec![2, 1];
    for _ in 0..31 {
        unloaded.extend([255, 255]);
    }
    unloaded.extend([97 + 126, 255]);
    assert_eq!(at(&unloaded), Err(DecodeError::NotABlock));
}

#[test]
#[should_panic(expected = "not a block")]
fn the_unloaded_marker_cannot_be_written() {
    encode(1, &filled(3), &filled(UNLOADED));
}

#[test]
fn a_sparse_value_is_only_read_over_the_generator_it_was_written_on() {
    let generated = filled(3);
    let mut current = generated.clone();
    current[10] = 5;
    let sparse = encode(1, &generated, &current);
    assert_eq!(apply(&sparse, 1, &generated).unwrap(), current);
    assert_eq!(
        apply(&sparse, 2, &generated),
        Err(DecodeError::GeneratorMismatch { value: 1, have: 2 })
    );
    // A dense value is the whole chunk, so it reads over any generator.
    let dense = encode(1, &filled(0), &noise());
    assert_eq!(dense[0], 2);
    assert_eq!(apply(&dense, 2, &generated).unwrap(), noise());
}
