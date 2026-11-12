// Queues the Azure DevOps pipeline with the values chosen in the UI.
// Required app settings: ADO_ORG, ADO_PROJECT, ADO_PIPELINE_ID, ADO_PAT
// (PAT scope: Build -> Read & execute)

const OPTIONS_URL = "https://countriesnow.space/api/v0.1/countries/states";

function reply(context, status, body) {
  context.res = {
    status,
    headers: { "Content-Type": "application/json" },
    body
  };
}

module.exports = async function (context, req) {
  const { ADO_ORG, ADO_PROJECT, ADO_PIPELINE_ID, ADO_PAT } = process.env;
  if (!ADO_ORG || !ADO_PROJECT || !ADO_PIPELINE_ID || !ADO_PAT) {
    return reply(context, 500, { error: "Server is not configured." });
  }

  const { country, state, selectedStates } = req.body || {};
  const others = Array.isArray(selectedStates) ? selectedStates : [];

  const isText = (v) => typeof v === "string" && v.length > 0 && v.length <= 100;
  if (!isText(country) || !isText(state) || others.length > 500 || !others.every(isText)) {
    return reply(context, 400, { error: "Invalid input." });
  }

  // Re-validate the selection against the API data (never trust the browser).
  let countries;
  try {
    const r = await fetch(OPTIONS_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
    countries = (await r.json()).data || [];
  } catch (e) {
    return reply(context, 502, { error: "Could not validate against the options API." });
  }
  const match = countries.find((c) => c.name === country);
  const valid = match ? new Set(match.states.map((s) => s.name)) : new Set();
  if (!valid.has(state) || !others.every((s) => valid.has(s))) {
    return reply(context, 400, { error: "State selection does not belong to the chosen country." });
  }

  const url =
    `https://dev.azure.com/${encodeURIComponent(ADO_ORG)}/${encodeURIComponent(ADO_PROJECT)}` +
    `/_apis/pipelines/${encodeURIComponent(ADO_PIPELINE_ID)}/runs?api-version=7.1`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(":" + ADO_PAT).toString("base64")
    },
    body: JSON.stringify({
      templateParameters: {
        country,
        state,
        selectedStates: others.join(",")
      }
    })
  });

  if (!response.ok) {
    context.log.error("Azure DevOps responded " + response.status);
    return reply(context, 502, { error: "Azure DevOps rejected the request (" + response.status + ")." });
  }

  const run = await response.json();
  return reply(context, 200, { id: run.id, url: run._links && run._links.web && run._links.web.href });
};
