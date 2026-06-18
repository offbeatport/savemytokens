# Exporting your LLM usage

SaveMyTokens reads **usage metadata only** - provider, model, date, project/API key,
input/output tokens, request count, cost, and (optionally) errors. **No prompts or
responses.** Upload a CSV **or** JSON; columns are auto-mapped (e.g. `prompt_tokens`
→ input, `completion_tokens` → output, `api_key`/`project_id` → project). If a cost
column is missing, cost is estimated from tokens × list price.

The same steps are shown in-product on the **/scan** page.

## OpenAI

**Dashboard (no key):**
1. Open the [Usage dashboard](https://platform.openai.com/usage) (Settings → Organization → Usage). You must be an org **owner** to export.
2. Set the date range to the last 30 days; optionally filter to a project.
3. Click **Export** → choose the **usage / activity** export (date, model, project, tokens). A CSV downloads.
4. Drag the CSV onto the upload box.

**API (one clean file):**
```bash
OPENAI_ADMIN_KEY=sk-admin-... node scripts/openai-usage.mjs > openai-usage.csv
```
Uses `GET /v1/organization/usage/completions` grouped by model + project (30 days).
Create an admin key at platform.openai.com/settings/organization/admin-keys.

## Anthropic

**Dashboard:** [Claude Console → Usage](https://console.anthropic.com/settings/usage) → filter by workspace/model/month → **Export** CSV.

**API:** Admin key (`sk-ant-admin…`), endpoint `/v1/organizations/usage_report/messages` (`group_by[]=model`). Save the JSON and upload it directly - SaveMyTokens reads the bucket shape.

## Google Gemini

Gemini API spend is billed through **Google Cloud Billing**.
- Quick view: AI Studio → **Dashboard → Usage & limits** (daily cost by project/model).
- Export: [Cloud Billing → Reports](https://console.cloud.google.com/billing) → filter service to **Gemini API** → set range → **Download CSV**.
- For per-token detail, configure a BigQuery billing export.

## Accepted formats

- **CSV** with a header row (any common column names - auto-mapped).
- **JSON** - a raw array of row objects, or an OpenAI/Anthropic Usage API response
  (`{ "data": [ { "start_time": …, "results": [ … ] } ] }`).

> Sources: OpenAI [usage export help](https://help.openai.com/en/articles/20001072-how-do-i-export-monthly-usage-details-from-the-api-usage-dashboard) & [Usage API](https://developers.openai.com/cookbook/examples/completions_usage_api); Anthropic [cost & usage reporting](https://support.anthropic.com/en/articles/9534590-cost-and-usage-reporting-in-console) & [Usage/Cost API](https://docs.anthropic.com/en/api/usage-cost-api); Google [Gemini billing](https://ai.google.dev/gemini-api/docs/billing).
