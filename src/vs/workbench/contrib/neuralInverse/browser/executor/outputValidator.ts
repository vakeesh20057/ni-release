/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Output Validator
 *
 * Validates a step's finalOutput against a developer-defined schema.
 * Zero external dependencies — uses an inline JSON Schema subset checker.
 *
 * ## Supported formats
 *
 * - 'json'        — parseable JSON, optional requiredKeys check
 * - 'text'        — any string, optional pattern (regex) and maxLength
 * - 'markdown'    — same as text (markdown is just text with conventions)
 * - 'json-schema' — full JSON Schema subset validation (object/array/type/required/enum/properties)
 */

import { IStepOutputSchema } from '../../common/workflowTypes.js';

export interface IOutputValidationResult {
	valid: boolean;
	errors: string[];
}

export function validateStepOutput(
	output: string,
	schema: IStepOutputSchema,
): IOutputValidationResult {
	const errors: string[] = [];

	// ── maxLength guard (applies to all formats) ──────────────────────────────
	if (schema.maxLength !== undefined && output.length > schema.maxLength) {
		errors.push(`Output length ${output.length} exceeds maxLength ${schema.maxLength}`);
	}

	switch (schema.format) {

		case 'json': {
			let parsed: unknown;
			try {
				parsed = JSON.parse(output);
			} catch {
				errors.push('Output is not valid JSON');
				break;
			}
			if (schema.requiredKeys && schema.requiredKeys.length > 0) {
				if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
					errors.push('Output must be a JSON object when requiredKeys are specified');
				} else {
					const obj = parsed as Record<string, unknown>;
					for (const key of schema.requiredKeys) {
						if (!(key in obj)) {
							errors.push(`Required key "${key}" missing from JSON output`);
						}
					}
				}
			}
			break;
		}

		case 'text':
		case 'markdown': {
			if (schema.pattern) {
				try {
					const re = new RegExp(schema.pattern, 's');
					if (!re.test(output)) {
						errors.push(`Output does not match required pattern: ${schema.pattern}`);
					}
				} catch {
					errors.push(`Invalid pattern regex: ${schema.pattern}`);
				}
			}
			break;
		}

		case 'json-schema': {
			let parsed: unknown;
			try {
				parsed = JSON.parse(output);
			} catch {
				errors.push('Output is not valid JSON (required for json-schema format)');
				break;
			}
			if (schema.jsonSchema) {
				const schemaErrors = _validateJsonSchema(parsed, schema.jsonSchema, '$');
				errors.push(...schemaErrors);
			}
			break;
		}
	}

	return { valid: errors.length === 0, errors };
}

// ─── Inline JSON Schema Subset Validator ─────────────────────────────────────
// Covers: type, required, properties, items, enum, minLength, maxLength,
//         minimum, maximum, minItems, maxItems, additionalProperties (boolean).
// Does NOT cover: $ref, $defs, allOf/anyOf/oneOf, format, pattern on schemas.

function _validateJsonSchema(
	value: unknown,
	schema: Record<string, unknown>,
	path: string,
): string[] {
	const errors: string[] = [];

	// type check
	if ('type' in schema) {
		const typeError = _checkType(value, schema['type'] as string | string[], path);
		if (typeError) errors.push(typeError);
	}

	// enum check
	if ('enum' in schema && Array.isArray(schema['enum'])) {
		if (!schema['enum'].includes(value)) {
			errors.push(`${path} must be one of [${(schema['enum'] as unknown[]).map(v => JSON.stringify(v)).join(', ')}], got ${JSON.stringify(value)}`);
		}
	}

	// string-specific
	if (typeof value === 'string') {
		if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
			errors.push(`${path} length ${value.length} is less than minLength ${schema['minLength']}`);
		}
		if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
			errors.push(`${path} length ${value.length} exceeds maxLength ${schema['maxLength']}`);
		}
	}

	// number-specific
	if (typeof value === 'number') {
		if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
			errors.push(`${path} value ${value} is less than minimum ${schema['minimum']}`);
		}
		if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
			errors.push(`${path} value ${value} exceeds maximum ${schema['maximum']}`);
		}
	}

	// object-specific
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;

		if ('required' in schema && Array.isArray(schema['required'])) {
			for (const key of schema['required'] as string[]) {
				if (!(key in obj)) {
					errors.push(`${path} is missing required property "${key}"`);
				}
			}
		}

		if ('properties' in schema && typeof schema['properties'] === 'object' && schema['properties'] !== null) {
			const props = schema['properties'] as Record<string, unknown>;
			for (const [key, subSchema] of Object.entries(props)) {
				if (key in obj) {
					errors.push(..._validateJsonSchema(obj[key], subSchema as Record<string, unknown>, `${path}.${key}`));
				}
			}
		}

		if (schema['additionalProperties'] === false) {
			const allowedKeys = new Set(Object.keys((schema['properties'] as object | undefined) ?? {}));
			for (const key of Object.keys(obj)) {
				if (!allowedKeys.has(key)) {
					errors.push(`${path} has unexpected additional property "${key}"`);
				}
			}
		}
	}

	// array-specific
	if (Array.isArray(value)) {
		if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
			errors.push(`${path} has ${value.length} items, minimum is ${schema['minItems']}`);
		}
		if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
			errors.push(`${path} has ${value.length} items, maximum is ${schema['maxItems']}`);
		}
		if ('items' in schema && typeof schema['items'] === 'object' && schema['items'] !== null) {
			const itemSchema = schema['items'] as Record<string, unknown>;
			value.forEach((item, i) => {
				errors.push(..._validateJsonSchema(item, itemSchema, `${path}[${i}]`));
			});
		}
	}

	return errors;
}

function _checkType(value: unknown, type: string | string[], path: string): string | null {
	const types = Array.isArray(type) ? type : [type];
	const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
	if (!types.includes(actualType)) {
		return `${path} must be of type ${types.join('|')}, got ${actualType}`;
	}
	return null;
}
