const axios = require('axios');

const TRUSTED_GITHUB_HOSTS = [
  'https://api.github.com/',
  'https://raw.githubusercontent.com/'
];

function getHeaders(url) {
  const token = process.env.KENJI_GITHUB_TOKEN;

  const headers = {
    'User-Agent': 'kenji-cli'
  };

  // Only send the token to trusted GitHub domains — never to third-party URLs
  const isTrusted = url && TRUSTED_GITHUB_HOSTS.some(host => url.startsWith(host));
  if (token && isTrusted) {
    headers['Authorization'] = `token ${token}`;
  }

  return headers;
}

async function fetchRepoContents(owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const response = await axios.get(apiUrl, { headers: getHeaders(apiUrl) });
  return response.data;
}

async function fetchRawFile(url) {
  const response = await axios.get(url, { headers: getHeaders(url) });
  return response.data;
}

function isRawGitHubUrl(input) {
  return input.startsWith('https://raw.githubusercontent.com/');
}

function isGitHubTreeUrl(input) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\//.test(input);
}

function isGitHubBlobUrl(input) {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(input);
}

// Converts https://github.com/user/repo/blob/branch/path/file.md
//        → https://raw.githubusercontent.com/user/repo/branch/path/file.md
function blobToRawUrl(url) {
  return url
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
}

// Parses https://github.com/{owner}/{repo}/tree/{branch}/{subpath}
function parseGitHubTreeUrl(url) {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    branch: match[3],
    subpath: match[4] || ''
  };
}

module.exports = {
  fetchRepoContents,
  fetchRawFile,
  isRawGitHubUrl,
  isGitHubTreeUrl,
  isGitHubBlobUrl,
  blobToRawUrl,
  parseGitHubTreeUrl,
  getHeaders
};
