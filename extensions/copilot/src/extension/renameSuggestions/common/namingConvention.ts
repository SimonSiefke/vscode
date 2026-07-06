/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const regexpZ0 = /^[a-z][a-z0-9]*$/;
const regexpZAZ0 = /^[a-z][a-zA-Z0-9]*$/;
const regexpZ01 = /^[a-z]+(_[a-z0-9]+)*$/;
const regexpZ02 = /^[a-z]+(-[a-z0-9]+)*$/;
const regexpZ03 = /^[A-Z][a-z0-9]*$/;
const regexpZ0Z0 = /^[A-Z0-9]+(_[A-Z0-9]+)+$/;
const regexp7 = /^[A-Z]+$/;
const regexpZAZ01 = /^[A-Z][a-zA-Z0-9]*$/;
const regexpZ0Z01 = /^[A-Z][a-z0-9]*(_[a-z0-9]+)*$/;
const regexp10 = /(?=[A-Z])/;
const regexp11 = /[-_]/;

export enum NamingConvention {
	/** example: camelCase */
	CamelCase = 'camelCase',

	/** example: PascalCase */
	PascalCase = 'PascalCase',

	/** example: snake_case */
	SnakeCase = 'snake_case',

	/** example: SCREAMING_SNAKE_CASE */
	ScreamingSnakeCase = 'SCREAMING_SNAKE_CASE',

	/** example: Capital_snake_case */
	CapitalSnakeCase = 'Capital_snake_case',

	/** example: kebab-case */
	KebabCase = 'kebab-case',

	/** example: Capitalized */
	Capitalized = 'Capitalized',

	/** example: ALLCAPS */
	Uppercase = 'Uppercase',

	/**
	 * example: lowercase
	 *
	 * @remark could also be camel case, snake case, kebab case, e.g., `foo`
	 */
	LowerCase = 'lowercase',

	Unknown = 'Unknown',
}

// Regular expressions for each naming convention

export function guessNamingConvention(ident: string): NamingConvention {

	// lowercase
	if (regexpZ0.test(ident)) {
		return NamingConvention.LowerCase;
	}

	// camelCase
	if (regexpZAZ0.test(ident)) {
		return NamingConvention.CamelCase;
	}

	// snake_case
	if (regexpZ01.test(ident)) {
		return NamingConvention.SnakeCase;
	}

	// kebab-case
	if (regexpZ02.test(ident)) {
		return NamingConvention.KebabCase;
	}

	// Capitalized
	if (regexpZ03.test(ident)) {
		return NamingConvention.Capitalized;
	}

	// SCREAMING_SNAKE_CASE
	if (regexpZ0Z0.test(ident)) {
		return NamingConvention.ScreamingSnakeCase;
	}

	// UPPERCASE
	if (regexp7.test(ident)) {
		return NamingConvention.Uppercase;
	}

	// PascalCase
	if (regexpZAZ01.test(ident)) {
		return NamingConvention.PascalCase;
	}

	// Capital_snake_case
	if (regexpZ0Z01.test(ident)) {
		return NamingConvention.CapitalSnakeCase;
	}

	return NamingConvention.Unknown;
}

function chunksToCamelCase(chunks: string[]): string {
	return chunks.map((chunk, i) => {
		if (i === 0) {
			return chunk.toLowerCase();
		}

		return chunk.charAt(0).toUpperCase() + chunk.substring(1).toLowerCase();
	}).join('');
}

function chunksToPascalCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.charAt(0).toUpperCase() + chunk.substring(1).toLowerCase()).join('');
}

function chunksToSnakeCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.toLowerCase()).join('_');
}

function chunksToKebabCase(chunks: string[]): string {
	return chunks.map(chunk => chunk.toLowerCase()).join('-');
}

export function enforceNamingConvention(givenIdent: string, targetConvention: NamingConvention): string {

	const namingConvention = guessNamingConvention(givenIdent);

	if (namingConvention === targetConvention) {
		return givenIdent;
	} else {
		const chunks = chunkUpIdentByConvention(givenIdent, namingConvention);
		switch (targetConvention) {
			case NamingConvention.CamelCase:
				return chunksToCamelCase(chunks);
			case NamingConvention.PascalCase:
				return chunksToPascalCase(chunks);
			case NamingConvention.SnakeCase:
				return chunksToSnakeCase(chunks);
			case NamingConvention.ScreamingSnakeCase:
				return chunksToSnakeCase(chunks).toUpperCase();
			case NamingConvention.CapitalSnakeCase:
				return chunksToSnakeCase(chunks).charAt(0).toUpperCase() + chunksToSnakeCase(chunks).substring(1);
			case NamingConvention.KebabCase:
				return chunksToKebabCase(chunks);
			case NamingConvention.Capitalized:
				return chunksToCamelCase(chunks).charAt(0).toUpperCase() + chunksToCamelCase(chunks).substring(1);
			case NamingConvention.Uppercase:
				return givenIdent.toUpperCase();
			case NamingConvention.LowerCase:
				return givenIdent.toLowerCase();
			case NamingConvention.Unknown:
				return givenIdent;
		}
	}
}

export function chunkUpIdentByConvention(ident: string, identConvention: NamingConvention): string[] {
	switch (identConvention) {
		case NamingConvention.CamelCase:
		case NamingConvention.PascalCase:
			return ident.split(regexp10);
		case NamingConvention.SnakeCase:
		case NamingConvention.ScreamingSnakeCase:
		case NamingConvention.CapitalSnakeCase:
		case NamingConvention.KebabCase:
			return ident.split(regexp11).map(chunk => chunk.toLowerCase());
		case NamingConvention.Capitalized:
		case NamingConvention.Uppercase:
		case NamingConvention.LowerCase:
		case NamingConvention.Unknown:
			return [ident];
	}
}
