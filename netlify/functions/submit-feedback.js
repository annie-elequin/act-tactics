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

async function uploadScreenshot(apiKey, base64Data, contentType) {
  const buffer = Buffer.from(base64Data, 'base64');
  const size = buffer.length;
  const ext = contentType.split('/')[1] || 'png';
  const filename = `feedback-screenshot.${ext}`;

  // Ask Linear for a signed upload URL
  const uploadData = await linearRequest(apiKey, `
    mutation {
      fileUpload(contentType: "${contentType}", filename: "${filename}", size: ${size}) {
        success
        uploadFile {
          uploadUrl
          assetUrl
          headers { key value }
        }
      }
    }
  `);

  if (!uploadData.data?.fileUpload?.success) return null;

  const { uploadUrl, assetUrl, headers } = uploadData.data.fileUpload.uploadFile;

  // Upload the binary to S3
  const uploadHeaders = { 'Content-Type': contentType };
  (headers || []).forEach(h => { uploadHeaders[h.key] = h.value; });

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: buffer,
  });

  return assetUrl;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'LINEAR_API_KEY not configured' }) };
  }

  let title, description, screenshotData, screenshotType;
  try {
    ({ title, description, screenshotData, screenshotType } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!title?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Title is required' }) };
  }

  // Resolve team + project
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

  // Upload screenshot if provided, then append to description
  let fullDescription = description?.trim() ?? '';
  if (screenshotData && screenshotType) {
    try {
      const assetUrl = await uploadScreenshot(apiKey, screenshotData, screenshotType);
      if (assetUrl) {
        fullDescription += (fullDescription ? '\n\n' : '') + `![Screenshot](${assetUrl})`;
      }
    } catch {
      // Non-fatal — submit without screenshot
    }
  }

  const mutation = `
    mutation {
      issueCreate(input: {
        teamId: "${team.id}"
        ${project ? `projectId: "${project.id}"` : ''}
        title: ${JSON.stringify(title.trim())}
        description: ${JSON.stringify(fullDescription)}
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
