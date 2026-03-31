const TEAM_IDENTIFIER = 'ANN';
const PROJECT_NAME = 'Act Tactics Visualizer';
const LINEAR_API = 'https://api.linear.app/graphql';

async function linearRequest(apiKey, query) {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'LINEAR_API_KEY not configured' }) };
  }

  let title, description;
  try {
    ({ title, description } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!title?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Title is required' }) };
  }

  // Resolve team UUID and project ID in one query
  let teamId = null;
  let projectId = null;
  try {
    const data = await linearRequest(apiKey, `
      query {
        teams {
          nodes {
            id
            identifier
            projects { nodes { id name } }
          }
        }
      }
    `);
    const team = data.data?.teams?.nodes?.find(t => t.identifier === TEAM_IDENTIFIER);
    teamId = team?.id ?? null;
    const project = team?.projects?.nodes?.find(p => p.name === PROJECT_NAME);
    projectId = project?.id ?? null;
  } catch {
    // fall through — will fail below if teamId is still null
  }

  if (!teamId) {
    return { statusCode: 500, body: JSON.stringify({ error: `Could not find team with identifier "${TEAM_IDENTIFIER}"` }) };
  }

  const mutation = `
    mutation {
      issueCreate(input: {
        teamId: "${teamId}"
        ${projectId ? `projectId: "${projectId}"` : ''}
        title: ${JSON.stringify(title.trim())}
        description: ${JSON.stringify(description?.trim() ?? '')}
      }) {
        success
        issue { id identifier url }
      }
    }
  `;

  try {
    const data = await linearRequest(apiKey, mutation);
    if (data.data?.issueCreate?.success) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, issue: data.data.issueCreate.issue }),
      };
    }
    const msg = data.errors?.[0]?.message ?? 'Linear returned an error';
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
