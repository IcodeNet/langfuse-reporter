These files are hand-built from the response schemas in Langfuse's published OpenAPI document
(https://cloud.langfuse.com/generated/api/openapi.yml), not captured from a live Langfuse server.
Ids, names and text are invented. Field names, types, nullable fields and the cursor in `meta`
follow the schema: `ScoreV3` (with its `subject` object), `ObservationV2` and the projects response.
The Metrics API returns rows whose keys depend on the query, so that file holds only the
`environment` dimension the client asks for.

When Langfuse changes a response, update these files from the new schema first; the contract test then
shows what in the client needs to follow.
