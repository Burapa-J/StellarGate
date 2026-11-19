//! Drift guard: every environment variable that `Config` reads must be
//! documented in `.env.example`, so operators copying the template learn that
//! the setting exists (issue #977).

use std::collections::BTreeSet;

/// Collects the names passed to `parse_env("…")`, `std::env::var("…")` and
/// `env::var("…")` in `src/config.rs`.
fn env_keys_read_by_config() -> BTreeSet<String> {
    let src = include_str!("../src/config.rs");
    let mut keys = BTreeSet::new();
    for marker in ["parse_env(", "env::var("] {
        let mut rest = src;
        while let Some(idx) = rest.find(marker) {
            rest = &rest[idx + marker.len()..];
            // Skip whitespace (the call may be split across lines) and expect a
            // string literal holding an upper-case env name.
            let trimmed = rest.trim_start();
            let Some(after_quote) = trimmed.strip_prefix('"') else {
                continue;
            };
            let name: String = after_quote
                .chars()
                .take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_')
                .collect();
            let closes = after_quote[name.len()..].starts_with('"');
            if closes && !name.is_empty() && name.chars().next().unwrap().is_ascii_uppercase() {
                keys.insert(name);
            }
        }
    }
    keys
}

/// Names assigned in `.env.example`, whether active (`KEY=`) or commented
/// out (`# KEY=`).
fn env_keys_documented() -> BTreeSet<String> {
    include_str!("../.env.example")
        .lines()
        .filter_map(|line| {
            let line = line.trim_start().trim_start_matches('#').trim_start();
            let (key, _) = line.split_once('=')?;
            let valid = !key.is_empty()
                && key
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
            valid.then(|| key.to_string())
        })
        .collect()
}

#[test]
fn every_env_var_read_by_config_is_in_env_example() {
    let read = env_keys_read_by_config();
    let documented = env_keys_documented();

    // Sanity check the scanner itself, so an empty result cannot pass vacuously.
    assert!(
        read.contains("PORT"),
        "scanner failed to find PORT: {read:?}"
    );
    assert!(read.contains("ADMIN_PROVISIONING_SECRET"));

    let missing: Vec<&String> = read.difference(&documented).collect();
    assert!(
        missing.is_empty(),
        "variables read by src/config.rs but missing from .env.example: {missing:?}"
    );
}
