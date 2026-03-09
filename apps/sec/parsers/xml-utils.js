/**
 * Lightweight XML extraction utilities for SEC filing XML.
 * These are purpose-built for the well-structured SEC XML schemas
 * (ownershipDocument, formDDocument, etc.) — no external dependency needed.
 */

/**
 * Extract text content of the first matching XML tag.
 * e.g. extractTag(xml, 'rptOwnerName') => "Hahn Ava"
 */
function extractTag(xml, tagName) {
  const regex = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*</${tagName}>`);
  const match = xml.match(regex);
  if (!match) return null;
  // If the content contains a <value> wrapper, extract that
  const valueMatch = match[1].match(/<value>\s*([\s\S]*?)\s*<\/value>/);
  return valueMatch ? valueMatch[1].trim() : match[1].trim();
}

/**
 * Extract all occurrences of a tag as an array of raw XML blocks.
 * Useful for repeating elements like <nonDerivativeTransaction>.
 */
function extractAllBlocks(xml, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'g');
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Extract the value of a tag, returning a number if it looks numeric.
 */
function extractNumber(xml, tagName) {
  const val = extractTag(xml, tagName);
  if (val === null || val === '') return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : num;
}

/**
 * Extract a boolean-like value (0/1, true/false).
 */
function extractBool(xml, tagName) {
  const val = extractTag(xml, tagName);
  if (val === null) return false;
  return val === '1' || val.toLowerCase() === 'true';
}

/**
 * Extract the embedded XML document from a .txt SEC filing.
 * SEC filings wrap XML in: <TEXT><XML>...actual xml...</XML></TEXT>
 */
function extractEmbeddedXml(rawContent) {
  const match = rawContent.match(/<XML>\s*([\s\S]*?)\s*<\/XML>/);
  return match ? match[1] : null;
}

/**
 * Extract embedded HTML content from a .txt SEC filing.
 * For forms like 8-K, DEF 14A that contain HTML.
 */
function extractEmbeddedHtml(rawContent) {
  // Try XBRL first (newer filings)
  let match = rawContent.match(/<XBRL>\s*([\s\S]*?)\s*<\/XBRL>/);
  if (match) return match[1];
  // Then try plain HTML
  match = rawContent.match(/<HTML>\s*([\s\S]*?)\s*<\/HTML>/i);
  if (match) return match[1];
  // Fallback: everything after <TEXT> that looks like HTML
  match = rawContent.match(/<TEXT>\s*([\s\S]*?)\s*<\/TEXT>/);
  return match ? match[1] : null;
}

/**
 * Decode HTML entities commonly found in SEC filings.
 */
function decodeEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Strip HTML tags from text content.
 */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  extractTag,
  extractAllBlocks,
  extractNumber,
  extractBool,
  extractEmbeddedXml,
  extractEmbeddedHtml,
  decodeEntities,
  stripHtml,
};
