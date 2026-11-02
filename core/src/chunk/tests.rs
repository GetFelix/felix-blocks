use super::*;

fn chunk_of(block: u8) -> Vec<u8> {
    vec![block; CELLS]
}

#[test]
fn cells_are_numbered_with_layers_contiguous() {
    assert_eq!(cell(0, 0, 0), 0);
    assert_eq!(cell(15, 0, 0), 15);
    assert_eq!(cell(0, 0, 1), 16);
    assert_eq!(cell(0, 1, 0), 256);
    assert_eq!(cell(15, 15, 15), CELLS - 1);
}

#[test]
fn a_new_padded_chunk_is_unloaded_everywhere() {
    let p = Padded::new();
    assert_eq!(p.at(-1, -1, -1), UNLOADED);
    assert_eq!(p.at(8, 8, 8), UNLOADED);
    assert_eq!(p.at(16, 16, 16), UNLOADED);
}

#[test]
fn the_chunk_itself_fills_the_inside_and_nothing_else() {
    let mut p = Padded::new();
    p.set_chunk([0, 0, 0], &chunk_of(3));
    assert_eq!(p.at(0, 0, 0), 3);
    assert_eq!(p.at(15, 15, 15), 3);
    assert_eq!(p.at(-1, 0, 0), UNLOADED);
    assert_eq!(p.at(16, 0, 0), UNLOADED);
}

#[test]
fn a_neighbour_gives_only_the_cells_that_touch_the_chunk() {
    let mut p = Padded::new();
    let mut east = chunk_of(0);
    east[cell(0, 5, 7)] = 9;
    east[cell(1, 5, 7)] = 8;
    p.set_chunk([1, 0, 0], &east);
    assert_eq!(p.at(16, 5, 7), 9);
    assert_eq!(p.at(16, 5, 6), 0);
    assert_eq!(p.at(16, -1, 7), UNLOADED);
    assert_eq!(p.at(15, 5, 7), UNLOADED);
}

#[test]
fn a_diagonal_neighbour_gives_one_corner_cell() {
    let mut p = Padded::new();
    let mut c = chunk_of(0);
    c[cell(15, 0, 15)] = 4;
    p.set_chunk([-1, 1, -1], &c);
    assert_eq!(p.at(-1, 16, -1), 4);
    assert_eq!(p.at(-1, 15, -1), UNLOADED);
}

#[test]
#[should_panic(expected = "4096 bytes")]
fn a_short_chunk_is_refused() {
    Padded::new().set_chunk([0, 0, 0], &[0; 10]);
}
