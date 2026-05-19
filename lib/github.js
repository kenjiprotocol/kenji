const axios = require('axios');

const TRUSTED_GITHUB_HOSTS = [
  'https://api.github.com/',
  'https://raw.githubusercontent.com/'
];

function getHeaders(url) {
  const token = process.env.KENJI_GITHUB_TOKEN;
  const headers = { 'User-Agent': 'kenji-cli' };
  const isTrusted = url && TRUSTED_GITHUB_HOSTS.some(host => url.startsWith(host));
  if (token && isTrusted) headers['Authorization'] = `token ${token}`;
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

/**
 * Fetch the full recursive git tree for a repo in a single API call.
 * Returns { tree: [{path, type, sha}], branch }.
 */
async function fetchRepoTree(owner, repo) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const repoRes = await axios.get(repoUrl, { headers: getHeaders(repoUrl) });
  const branch = repoRes.data.default_branch || 'main';

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const treeRes = await axios.get(treeUrl, { headers: getHeaders(treeUrl) });

  return { tree: treeRes.data.tree || [], branch };
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

function blobToRawUrl(url) {
  return url
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
}

function parseGitHubTreeUrl(url) {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2], branch: match[3], subpath: match[4] || '' };
}

module.exports = {
  fetchRepoContents,
  fetchRawFile,
  fetchRepoTree,
  isRawGitHubUrl,
  isGitHubTreeUrl,
  isGitHubBlobUrl,
  blobToRawUrl,
  parseGitHubTreeUrl,
  getHeaders
};
