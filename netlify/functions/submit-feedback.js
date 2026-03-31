const TEAM_ID = '7c677f9b-7fbf-4cf6-a493-5abfb41020b9';
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

  // Look up the project ID by name so we don't have to hardcode it
  let projectId = null;
  try {
    const projectData = await linearRequest(apiKey, `
      query {
        team(id: "${TEAM_ID}") {
          projects { nodes { id name } }
        }
      }
    `);
    const project = projectData.data?.team?.projects?.nodes?.find(p => p.name === PROJECT_NAME);
    projectId = project?.id ?? null;
  } catch {
    // If project lookup fails, fall through to team backlog
  }

  const mutation = `
    mutation {
      issueCreate(input: {
        teamId: "${TEAM_ID}"
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
