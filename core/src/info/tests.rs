use super::*;

#[test]
fn info_round_trips() {
    for seed in [0, 1, 7, 0xdead_beef, u32::MAX] {
        let info = WorldInfo::new(seed);
        assert_eq!(WorldInfo::decode(&info.encode()), Ok(info));
    }
}

#[test]
fn the_layout_is_fixed() {
    let info = WorldInfo {
        seed: 0x0403_0201,
        generator_version: 9,
        size: [0x0102, 0x0304, 0x0506],
        spawn: [-1, 0x0100_0002, 7],
    };
    assert_eq!(
        info.encode(),
        [
            1, 9, 1, 2, 3, 4, 2, 1, 4, 3, 6, 5, 0xff, 0xff, 0xff, 0xff, 2, 0, 0, 1, 7, 0, 0, 0
        ]
    );
}

#[test]
fn a_value_of_the_wrong_size_or_format_is_refused() {
    let good = WorldInfo::new(7).encode();
    assert_eq!(
        WorldInfo::decode(&good[..LEN - 1]),
        Err(DecodeError::WrongLength)
    );
    let mut long = good.to_vec();
    long.push(0);
    assert_eq!(WorldInfo::decode(&long), Err(DecodeError::WrongLength));
    let mut other = good;
    other[0] = 2;
    assert_eq!(
        WorldInfo::decode(&other),
        Err(DecodeError::UnknownFormat(2))
    );
}

#[test]
fn a_new_world_uses_the_newest_generator_and_the_whole_world() {
    let info = WorldInfo::new(7);
    assert_eq!(info.generator_version, GENERATOR_VERSION);
    assert_eq!(info.size, [256, 16, 256]);
}

#[test]
fn the_spawn_point_is_dry_with_room_to_stand() {
    for seed in 0..40 {
        let info = WorldInfo::new(seed);
        let [x, y, z] = info.spawn;
        let ground = ground_height(1, seed, x, z).unwrap();
        assert!(ground >= SEA_LEVEL, "seed {seed} spawns in water");
        assert_eq!(y, ground + 1, "seed {seed}");
        assert!(standing_room(1, seed, x, y, z), "seed {seed}");
        assert!((x - 2048).abs() <= SPAWN_SEARCH && (z - 2048).abs() <= SPAWN_SEARCH);
    }
}

#[test]
fn the_spawn_is_the_same_every_time() {
    assert_eq!(WorldInfo::new(7), WorldInfo::new(7));
}
