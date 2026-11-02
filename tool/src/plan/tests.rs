use super::*;

#[test]
fn names_are_a_small_safe_alphabet() {
    for good in ["demo", "a", "my-world-2", &"x".repeat(32)] {
        assert!(check_name(good).is_ok(), "{good}");
    }
    for bad in [
        "",
        "Demo",
        "my world",
        "-a",
        "a-",
        "a.b",
        "a/b",
        "wörld",
        &"x".repeat(33),
    ] {
        assert!(check_name(bad).is_err(), "{bad}");
    }
}

#[test]
fn the_principal_is_the_hash_of_issuer_and_subject() {
    // sha256("https://idp|ana")
    assert_eq!(
        principal("https://idp", "ana"),
        "742aea685538eb3304db414e65e3b6367a8ed7bdbf9c18ac8726fa7cc463289e"
    );
}

#[test]
fn a_world_has_five_resources_with_one_shard_each() {
    assert_eq!(
        caches("demo"),
        [
            "blocks.chunks.demo",
            "blocks.info.demo",
            "blocks.online.demo"
        ]
    );
    assert_eq!(
        streams("demo"),
        [
            ("blocks.presence.demo".to_owned(), false),
            ("blocks.chat.demo".to_owned(), true)
        ]
    );
    assert_eq!(cache("c")["shards"], 1);
    assert_eq!(stream("s", true)["shards"], 1);
}

#[test]
fn chat_is_kept_and_presence_may_be_lost() {
    let chat = stream("c", true);
    assert_eq!(chat["delivery"], "AtLeastOnce");
    assert_eq!(chat["retention"]["max_age_seconds"], 604_800);
    let presence = stream("p", false);
    assert_eq!(presence["delivery"], "AtMostOnce");
    assert!(presence["retention"]["max_age_seconds"].is_null());
}

#[test]
fn players_read_the_info_and_never_write_it() {
    let policies = policies("blocks", "default", "demo");
    let on_info: Vec<_> = policies
        .iter()
        .filter(|p| p["object"] == "cache:blocks/default/blocks.info.demo")
        .map(|p| p["action"].as_str().unwrap())
        .collect();
    assert_eq!(on_info, ["cache.read"]);
}

#[test]
fn every_policy_names_the_world_and_only_this_world() {
    for p in policies("blocks", "default", "demo") {
        assert_eq!(p["subject"], "role:world-demo");
        assert!(p["object"].as_str().unwrap().ends_with(".demo"), "{p}");
    }
}
