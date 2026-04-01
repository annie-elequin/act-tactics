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

  // Fetch the first team and look for the project in one query
  const lookupData = await linearRequest(apiKey, `
    query {
      viewer {
        teams {
          nodes {
            id
            projects { nodes { id name } }
          }
        }
      }
    }
  `);

  if (lookupData.errors?.length) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Linear API error: ' + lookupData.errors[0].message }) };
  }

  const team = lookupData.data?.viewer?.teams?.nodes?.[0];
  if (!team) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No teams found for this API key' }) };
  }

  const project = team.projects?.nodes?.find(p => p.name === PROJECT_NAME);

  // Create the issue
  const mutation = `
    mutation {
      issueCreate(input: {
        teamId: "${team.id}"
        ${project ? `projectId: "${project.id}"` : ''}
        title: ${JSON.stringify(title.trim())}
        description: ${JSON.stringify(description?.trim() ?? '')}
      }) {
        success
        issue { id identifier url }
      }
    }
  `;

  const createData = await linearRequest(apiKey, mutation);

  if (createData.data?.issueCreate?.success) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, issue: createData.data.issueCreate.issue }),
    };
  }

  const msg = createData.errors?.[0]?.message ?? 'Linear returned an error';
  return { statusCode: 500, body: JSON.stringify({ error: msg }) };
};
