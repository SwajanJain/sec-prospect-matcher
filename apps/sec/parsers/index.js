/**
 * Filing Parser Router
 *
 * Routes each SEC filing to the appropriate specialized parser based on form type.
 * Every filing gets:
 *   1. Header parsing (common metadata)
 *   2. Specialized parsing (form-type-specific structured data)
 *   3. A normalized result with { persons, transactions, alerts }
 */

const { parseHeader, normalizeFormType, extractRawText } = require('./header-parser');
const { parseForm4 } = require('./form4-parser');
const { parseForm3 } = require('./form3-parser');
const { parseForm144 } = require('./form144-parser');
const { parseFormD } = require('./formD-parser');
const { parseForm8K } = require('./form8k-parser');
const { parseSchedule13 } = require('./schedule13-parser');
const { parseForm13F } = require('./form13f-parser');
const { parseDef14A } = require('./def14a-parser');
const { parseGeneric } = require('./generic-parser');

/**
 * Parse a single SEC filing. Returns a structured result object.
 *
 * @param {string} rawContent - Full text content of the .txt filing
 * @param {string} filename - Original filename (accession number)
 * @returns {object} Parsed filing with header, structured data, persons, transactions, alerts
 */
function parseFiling(rawContent, filename) {
  const header = parseHeader(rawContent);
  const normalizedType = normalizeFormType(header.formType);

  let parsed;
  try {
    switch (normalizedType) {
      case 'FORM4':
        parsed = parseForm4(rawContent, header);
        break;
      case 'FORM3':
      case 'FORM5':
        parsed = parseForm3(rawContent, header);
        break;
      case 'FORM144':
        parsed = parseForm144(rawContent, header);
        break;
      case 'FORMD':
        parsed = parseFormD(rawContent, header);
        break;
      case '8K':
        parsed = parseForm8K(rawContent, header);
        break;
      case 'SC13D':
      case 'SC13G':
        parsed = parseSchedule13(rawContent, header);
        break;
      case '13FHR':
      case '13FNT':
        parsed = parseForm13F(rawContent, header);
        break;
      case 'DEF14A':
      case 'DEFA14A':
      case 'DEFC14A':
      case 'DEFM14A':
      case 'PRE14A':
      case 'PREM14A':
        parsed = parseDef14A(rawContent, header);
        break;
      default:
        parsed = parseGeneric(rawContent, header);
        break;
    }
  } catch (err) {
    parsed = parseGeneric(rawContent, header);
    parsed.parseError = err.message;
  }

  // Attach common metadata
  return {
    filename,
    accessionNumber: header.accessionNumber,
    formType: header.formType,
    normalizedType,
    filedDate: header.filedDate,
    header,
    ...parsed,
  };
}

/**
 * Determine if a form type has a specialized parser.
 */
function hasSpecializedParser(formType) {
  const normalized = normalizeFormType(formType);
  return [
    'FORM4', 'FORM3', 'FORM5', 'FORM144', 'FORMD',
    '8K', 'SC13D', 'SC13G', '13FHR', '13FNT',
    'DEF14A', 'DEFA14A', 'DEFC14A', 'DEFM14A', 'PRE14A', 'PREM14A',
  ].includes(normalized);
}

module.exports = { parseFiling, hasSpecializedParser, normalizeFormType, extractRawText };
