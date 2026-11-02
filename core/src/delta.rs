//! The value stored under a chunk's key: the chunk's difference from the generated one.
//!
//! ```text
//! byte 0     format: 1 sparse, 2 dense
//! byte 1     generator version the chunk was edited on
//! sparse     count u16, then (cell index u16, block u8) per changed cell, in ascending cell order
//! dense      the chunk's 4,096 blocks, run-length encoded
//! ```
//!
//! Integers are little endian. A sparse value lists the cells that differ from the generated chunk, so
//! it needs that chunk to be read. A dense value is the whole chunk and does not. The writer encodes both
//! and keeps the shorter, so a lightly edited chunk is 3 bytes a changed cell and a chunk that was rebuilt
//! is what its runs compress to, at most 4,130 bytes.
//!
//! A dense value is run-length encoded in groups. A control byte below 128 is followed by that many plus
//! one literal blocks; a control byte of 128 or more is followed by one block, repeated that many minus
//! 126 times (2 to 129). A group never crosses the end of the chunk.

use crate::chunk::{CELLS, UNLOADED};
use std::fmt;

const SPARSE: u8 = 1;
const DENSE: u8 = 2;
const HEADER: usize = 2;
const LONGEST_RUN: usize = 129;
const LONGEST_LITERAL: usize = 128;

/// Why a stored value could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// Shorter than its own header or count says.
    Truncated,
    /// A format byte this code does not know.
    UnknownFormat(u8),
    /// Bytes left over after the value.
    TrailingBytes,
    /// A sparse cell index of 4,096 or more.
    CellOutOfRange,
    /// Sparse cells that are not in strictly ascending order.
    CellsNotAscending,
    /// A dense value that does not make exactly 4,096 blocks.
    WrongLength,
    /// The marker for a cell with no chunk loaded, which is never a block.
    NotABlock,
    /// A sparse value written on one generator, read over the chunk of another.
    GeneratorMismatch { value: u8, have: u8 },
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            DecodeError::Truncated => "the chunk value is cut short",
            DecodeError::UnknownFormat(_) => {
                "the chunk value has a format this build does not know"
            }
            DecodeError::TrailingBytes => "the chunk value has bytes after its end",
            DecodeError::CellOutOfRange => "a changed cell is outside the chunk",
            DecodeError::CellsNotAscending => "the changed cells are not in ascending order",
            DecodeError::WrongLength => "the chunk value does not hold 4096 blocks",
            DecodeError::NotABlock => "the chunk value holds a byte that is not a block",
            DecodeError::GeneratorMismatch { .. } => {
                "the chunk value was edited on another generator version than the one that made the chunk"
            }
        })
    }
}

impl std::error::Error for DecodeError {}

/// The value for a chunk whose blocks are now `current` where the generator made `generated`, written by a build
/// whose generator is `version`. The shorter encoding wins, sparse on a tie. Identical chunks give an empty sparse
/// value, which the caller may rather delete the key for.
///
/// # Panics
/// If either chunk is not [`CELLS`] bytes or `current` holds [`UNLOADED`].
pub fn encode(version: u8, generated: &[u8], current: &[u8]) -> Vec<u8> {
    assert_eq!(generated.len(), CELLS, "a chunk is {CELLS} bytes");
    assert_eq!(current.len(), CELLS, "a chunk is {CELLS} bytes");
    assert!(!current.contains(&UNLOADED), "{UNLOADED} is not a block");
    let sparse = encode_sparse(version, generated, current);
    let dense = encode_dense(version, current);
    if dense.len() < sparse.len() {
        dense
    } else {
        sparse
    }
}

fn encode_sparse(version: u8, generated: &[u8], current: &[u8]) -> Vec<u8> {
    let changed = generated
        .iter()
        .zip(current)
        .filter(|(a, b)| a != b)
        .count();
    let mut out = Vec::with_capacity(HEADER + 2 + 3 * changed);
    out.extend([SPARSE, version]);
    out.extend((changed as u16).to_le_bytes());
    for (i, (a, b)) in generated.iter().zip(current).enumerate() {
        if a != b {
            out.extend((i as u16).to_le_bytes());
            out.push(*b);
        }
    }
    out
}

fn encode_dense(version: u8, current: &[u8]) -> Vec<u8> {
    let mut out = vec![DENSE, version];
    let mut literal: Vec<u8> = Vec::new();
    let flush = |out: &mut Vec<u8>, literal: &mut Vec<u8>| {
        for group in literal.chunks(LONGEST_LITERAL) {
            out.push((group.len() - 1) as u8);
            out.extend(group);
        }
        literal.clear();
    };
    let mut i = 0;
    while i < current.len() {
        let block = current[i];
        let run = current[i..]
            .iter()
            .take(LONGEST_RUN)
            .take_while(|b| **b == block)
            .count();
        // A run splits the literals around it, which costs a control byte, so it only pays from four blocks on;
        // with nothing before it, two are enough.
        if run >= 4 || (run >= 2 && literal.is_empty()) {
            flush(&mut out, &mut literal);
            out.push((run + 126) as u8);
            out.push(block);
        } else {
            literal.extend(&current[i..i + run]);
        }
        i += run;
    }
    flush(&mut out, &mut literal);
    out
}

/// The generator version a value was written on, without reading the rest.
pub fn generator_version(value: &[u8]) -> Result<u8, DecodeError> {
    format(value).map(|_| value[1])
}

fn format(value: &[u8]) -> Result<u8, DecodeError> {
    match value {
        [] | [_] => Err(DecodeError::Truncated),
        [f @ (SPARSE | DENSE), ..] => Ok(*f),
        [f, ..] => Err(DecodeError::UnknownFormat(*f)),
    }
}

/// The chunk a stored value makes: `generated` with the value's changes on top, or for a dense value the blocks it
/// holds. A sparse value must list its cells in ascending order, as [`encode`] writes them.
///
/// `version` is the generator version `generated` was made with. A sparse value only means something over the
/// generator it was written on, so one written on another is refused instead of applied over the wrong terrain.
///
/// # Panics
/// If `generated` is not [`CELLS`] bytes.
pub fn apply(value: &[u8], version: u8, generated: &[u8]) -> Result<Vec<u8>, DecodeError> {
    assert_eq!(generated.len(), CELLS, "a chunk is {CELLS} bytes");
    let format = format(value)?;
    let body = &value[HEADER..];
    match format {
        SPARSE if value[1] != version => Err(DecodeError::GeneratorMismatch {
            value: value[1],
            have: version,
        }),
        SPARSE => apply_sparse(body, generated),
        _ => decode_dense(body),
    }
}

fn apply_sparse(body: &[u8], generated: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let (count, cells) = body
        .split_first_chunk::<2>()
        .ok_or(DecodeError::Truncated)?;
    let count = u16::from_le_bytes(*count) as usize;
    match cells.len().cmp(&(3 * count)) {
        std::cmp::Ordering::Less => return Err(DecodeError::Truncated),
        std::cmp::Ordering::Greater => return Err(DecodeError::TrailingBytes),
        std::cmp::Ordering::Equal => {}
    }
    let mut out = generated.to_vec();
    let mut next = 0;
    for change in cells.chunks_exact(3) {
        let index = u16::from_le_bytes([change[0], change[1]]) as usize;
        if index >= CELLS {
            return Err(DecodeError::CellOutOfRange);
        }
        if index < next {
            return Err(DecodeError::CellsNotAscending);
        }
        if change[2] == UNLOADED {
            return Err(DecodeError::NotABlock);
        }
        out[index] = change[2];
        next = index + 1;
    }
    Ok(out)
}

fn decode_dense(body: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let mut out = Vec::with_capacity(CELLS);
    let mut rest = body;
    while let Some((&control, tail)) = rest.split_first() {
        let (count, repeated, tail) = if control < 128 {
            let n = control as usize + 1;
            if tail.len() < n {
                return Err(DecodeError::Truncated);
            }
            (n, None, &tail[n..])
        } else {
            let (&block, tail) = tail.split_first().ok_or(DecodeError::Truncated)?;
            (control as usize - 126, Some(block), tail)
        };
        if out.len() + count > CELLS {
            return Err(DecodeError::WrongLength);
        }
        match repeated {
            Some(block) => out.resize(out.len() + count, block),
            None => out.extend(&rest[1..1 + count]),
        }
        rest = tail;
    }
    if out.len() != CELLS {
        return Err(DecodeError::WrongLength);
    }
    if out.contains(&UNLOADED) {
        return Err(DecodeError::NotABlock);
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
