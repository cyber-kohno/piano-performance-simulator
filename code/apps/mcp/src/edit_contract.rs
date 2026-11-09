use rmcp::schemars::{JsonSchema, Schema, SchemaGenerator};
use std::borrow::Cow;

pub struct ScoreOperations;

impl JsonSchema for ScoreOperations {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ScoreOperations")
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        serde_json::from_str(include_str!("../score-operations.schema.json"))
            .expect("generated score operation schema")
    }
}
