//! GBNF grammars handed to llama.cpp to constrain decoding.
//!
//! llama.cpp masks the sampler at every step against these rules, so the model
//! cannot produce text outside the grammar. This turns "usually valid JSON" into
//! "always valid JSON", which is the difference between a demo that works in
//! front of a panel and one that does not.

/// Forces `{"cards":[{"front":"…","back":"…"}, …]}` with at least one card.
pub const CARDS_GBNF: &str = r#"
root   ::= "{" ws "\"cards\"" ws ":" ws cards ws "}"
cards  ::= "[" ws card (ws "," ws card)* ws "]"
card   ::= "{" ws "\"front\"" ws ":" ws string ws "," ws "\"back\"" ws ":" ws string ws "}"
string ::= "\"" char* "\""
char   ::= [^"\\] | "\\" escape
escape ::= ["\\/bfnrt] | "u" hex hex hex hex
hex    ::= [0-9a-fA-F]
ws     ::= [ \t\n]*
"#;

#[cfg(test)]
mod tests {
    use super::CARDS_GBNF;

    #[test]
    fn grammar_declares_a_root_rule() {
        // llama.cpp rejects a grammar with no `root`, and the failure surfaces
        // as an opaque 500 at generation time rather than at startup.
        // Matched line-wise because the rules are space-aligned for readability.
        let has_root = CARDS_GBNF
            .lines()
            .any(|line| line.trim_start().starts_with("root") && line.contains("::="));
        assert!(has_root, "grammar must define a `root` rule");
    }

    #[test]
    fn grammar_requires_both_card_fields() {
        assert!(CARDS_GBNF.contains("\\\"front\\\""));
        assert!(CARDS_GBNF.contains("\\\"back\\\""));
    }
}
