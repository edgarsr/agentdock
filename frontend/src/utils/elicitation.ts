import { ElicitationContent, ElicitationOption, ElicitationProperty, ElicitationSchema } from '../types/elicitation';

export function elicitationOptions(field: ElicitationProperty): ElicitationOption[] | undefined {
  if (field.type === 'array') {
    return field.items?.anyOf ?? field.items?.enum?.map((value) => ({ const: value, title: value }));
  }
  return field.oneOf ?? field.enum?.map((value) => ({ const: value, title: value }));
}

export function initialElicitationValues(schema: ElicitationSchema): ElicitationContent {
  return Object.fromEntries(Object.entries(schema.properties).flatMap(([key, field]) => {
    const value = field.default ?? (field.type === 'boolean' ? false : field.type === 'array' ? [] : undefined);
    return value === undefined ? [] : [[key, value]];
  }));
}

/**
 * Keep numeric input as text while editing, converting it only when the form is submitted. A blank field is left
 * out, so the backend reports a required one as missing instead of accepting it empty.
 */
export function buildElicitationContent(schema: ElicitationSchema, values: ElicitationContent): ElicitationContent {
  return Object.fromEntries(Object.entries(schema.properties).flatMap(([key, field]) => {
    const value = values[key];
    if (value === undefined || (typeof value === 'string' && value.trim() === '')) return [];
    return [[key, (field.type === 'number' || field.type === 'integer') && typeof value === 'string' ? Number(value) : value]];
  }));
}
