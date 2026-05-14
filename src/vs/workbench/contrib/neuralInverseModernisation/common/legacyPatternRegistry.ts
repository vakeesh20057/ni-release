/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Neural Inverse Corporation. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * # Legacy Pattern Registry
 *
 * Known patterns for regulated attributes in legacy languages.
 * Used by the deterministic fingerprint extractor (Layer 1) to identify
 * regulated fields without relying on the LLM.
 *
 * ## Coverage
 *
 * - **COBOL (IBM z/OS dialect)**: Primary target. Covers billing, banking, and telecom COBOL.
 * - Extensible: add new language entries as new migration targets are supported.
 *
 * ## COBOL-Specific Notes
 *
 * - COMP-3 / COMPUTATIONAL-3 fields are ALWAYS treated as financial/regulated,
 *   regardless of field name. Packed decimal is used exclusively for monetary
 *   arithmetic in mainframe systems.
 * - PIC S9(x)V9(x) clauses indicate signed numeric fields with decimal places —
 *   almost always monetary in a billing or banking context.
 * - Field names in COBOL are case-insensitive. All patterns match case-insensitively.
 */

export interface IRegulatedFieldPattern {
	/** Regex pattern matched against the field name (case-insensitive) */
	namePattern: RegExp;
	/** The normalized semantic attribute this pattern represents */
	regulatedAttribute: string;
	/** The compliance framework that classifies this as regulated */
	framework: string;
	/** Human-readable description for the compliance strip UI */
	description: string;
}

export interface IStructuralPattern {
	/** Regex matched against the source line (case-insensitive) */
	linePattern: RegExp;
	/** What this structural pattern indicates */
	indicates: string;
	/** Whether fields on this line are always treated as regulated */
	alwaysRegulated: boolean;
}

export interface ILanguagePatterns {
	fieldPatterns: IRegulatedFieldPattern[];
	structuralPatterns: IStructuralPattern[];
	/** Paragraph/section/function name patterns that indicate regulated logic */
	paragraphPatterns: RegExp[];
}

// ─── COBOL Patterns ───────────────────────────────────────────────────────────

const COBOL_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	// Account identifiers
	{ namePattern: /ACCT|ACCOUNT|ACC-NO|ACCOUNT-NO|ACCOUNT-NUMBER|ACCOUNT-ID/i, regulatedAttribute: 'account_identifier', framework: 'financial-core', description: 'Account identifier field' },
	{ namePattern: /CUST|CUSTOMER|CLIENT|CLNT/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier field' },
	{ namePattern: /CARD|CARD-NO|CARD-NUMBER|PAN|PRIMARY-ACCT/i, regulatedAttribute: 'payment_card_number', framework: 'pci-dss', description: 'Payment card number (PAN) — PCI-DSS regulated' },

	// Monetary amounts
	{ namePattern: /BAL|BALANCE|CURR-BAL|CURRENT-BAL|AVAIL-BAL|AVAILABLE-BAL/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance field' },
	{ namePattern: /AMT|AMOUNT|TRAN-AMT|TRANS-AMT|PAYMENT-AMT|PAY-AMT/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount field' },
	{ namePattern: /PRIN|PRINCIPAL|PRIN-AMT|PRINCIPAL-AMT/i, regulatedAttribute: 'principal_amount', framework: 'financial-core', description: 'Principal amount field' },
	{ namePattern: /INT-AMT|INTEREST-AMT|ACCRUED-INT|ACCRUED-INTEREST/i, regulatedAttribute: 'interest_amount', framework: 'financial-core', description: 'Interest amount field' },
	{ namePattern: /FEE|CHARGE|PENALTY|FINE|LATE-FEE|LATE-CHARGE/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge field' },
	{ namePattern: /TAX|GST|VAT|WITHHOLDING|TAX-AMT/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount field — tax compliance regulated' },
	{ namePattern: /CREDIT|DEBIT|CR-AMT|DB-AMT/i, regulatedAttribute: 'credit_debit_amount', framework: 'financial-core', description: 'Credit or debit amount field' },

	// Rates and percentages
	{ namePattern: /RATE|INT-RATE|INTEREST-RATE|APR|APY/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate field' },
	{ namePattern: /TAX-RATE|TAX-PCT|TAX-PERCENT/i, regulatedAttribute: 'tax_rate', framework: 'tax-compliance', description: 'Tax rate field' },

	// Settlement and clearing
	{ namePattern: /SETTLE|SETTLEMENT|CLEARING|CLEAR-DATE|VALUE-DATE/i, regulatedAttribute: 'settlement', framework: 'financial-core', description: 'Settlement or clearing field' },
	{ namePattern: /TRAN|TRANS|TXN|TRANSACTION|TRAN-ID|TRAN-REF/i, regulatedAttribute: 'transaction_reference', framework: 'financial-core', description: 'Transaction reference field' },

	// Personal identifiers (privacy-regulated)
	{ namePattern: /SSN|SOCIAL-SEC|NI-NO|NATIONAL-INS|TIN|TAX-ID/i, regulatedAttribute: 'national_identifier', framework: 'gdpr-pii', description: 'National identifier — GDPR/PII regulated' },
	{ namePattern: /DOB|DATE-OF-BIRTH|BIRTH-DATE/i, regulatedAttribute: 'date_of_birth', framework: 'gdpr-pii', description: 'Date of birth — GDPR/PII regulated' },
	{ namePattern: /EMAIL|EMAIL-ADDR|E-MAIL/i, regulatedAttribute: 'email_address', framework: 'gdpr-pii', description: 'Email address — GDPR/PII regulated' },
	{ namePattern: /PHONE|TEL|TELEPHONE|MOBILE|CELL/i, regulatedAttribute: 'phone_number', framework: 'gdpr-pii', description: 'Phone number — GDPR/PII regulated' },

	// Audit and control fields
	{ namePattern: /AUDIT|AUDIT-TRAIL|AUDIT-LOG|AUDIT-CODE/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail field — SOX regulated' },
	{ namePattern: /AUTH|AUTHORI|APPROVAL|APPROV/i, regulatedAttribute: 'authorization', framework: 'financial-core', description: 'Authorization field' },

	// Telecom-specific
	{ namePattern: /CDR|CALL-DETAIL|CALL-REC|CALL-DATA/i, regulatedAttribute: 'call_detail_record', framework: 'telecom-billing', description: 'Call detail record — telecom billing regulated' },
	{ namePattern: /USAGE|ROAMING|ROAM|AIRTIME|DATA-USAGE/i, regulatedAttribute: 'usage_record', framework: 'telecom-billing', description: 'Usage record field — telecom billing' },
	{ namePattern: /BILL|INVOICE|BILLING|INV-AMT/i, regulatedAttribute: 'billing_amount', framework: 'telecom-billing', description: 'Billing amount field' },
];

const COBOL_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	// COMP-3 / packed decimal — ALWAYS financial regardless of field name
	{
		linePattern: /COMP-3|COMPUTATIONAL-3/i,
		indicates: 'packed_decimal_currency_field',
		alwaysRegulated: true,
	},
	// PIC S9(x)V9(x) — signed numeric with decimal places (monetary precision)
	{
		linePattern: /PIC\s+S9\([0-9]+\)V9\([0-9]+\)|PIC\s+S9+V9+/i,
		indicates: 'signed_decimal_numeric_monetary',
		alwaysRegulated: true,
	},
	// CICS commands — transactional operations in telecom/banking
	{
		linePattern: /EXEC\s+CICS\s+(READ|WRITE|REWRITE|DELETE|STARTBR|READNEXT|ENDBR)/i,
		indicates: 'cics_transaction_operation',
		alwaysRegulated: false,
	},
	// File I/O on FD (File Descriptor) entries that look like regulated data files
	{
		linePattern: /FD\s+[A-Z0-9-]+(ACCOUNT|TRANS|SETTLE|BILLING|AUDIT)/i,
		indicates: 'regulated_file_descriptor',
		alwaysRegulated: true,
	},
];

/** Paragraph names that indicate regulated business logic */
const COBOL_PARAGRAPH_PATTERNS: RegExp[] = [
	/CALC|COMPUTE|CALCULATE/i,
	/INTEREST|INT-CALC/i,
	/FEE|LATE-CHARGE|PENALTY/i,
	/SETTLE|SETTLEMENT|CLEARING/i,
	/AUDIT|TRAIL/i,
	/RECONCIL/i,
	/TAX/i,
	/BILL|BILLING|INVOICE/i,
	/PAYMENT|PAY-PROC/i,
	/AUTHORIZ|AUTH/i,
	/CDR|CALL-PROC/i,
	/CLOSE-OF-DAY|END-OF-DAY|EOD/i,
	/MONTH-END|YEAR-END/i,
];


// ─── Java EE / Legacy Java Patterns ──────────────────────────────────────────

const JAVA_EE_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /accountBalance|acctBal|accountAmt/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance field' },
	{ namePattern: /transactionAmount|txnAmount|tranAmt/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /interestRate|intRate|aprValue/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate field' },
	{ namePattern: /taxAmount|taxAmt|vatAmount|gstAmount/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount field' },
	{ namePattern: /customerId|clientId|custNo|accountId/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /cardNumber|panNumber|creditCard/i, regulatedAttribute: 'payment_card_number', framework: 'pci-dss', description: 'Payment card number — PCI-DSS' },
	{ namePattern: /ssn|socialSecurity|nationalId|tin\b/i, regulatedAttribute: 'national_identifier', framework: 'gdpr-pii', description: 'National identifier — GDPR/PII' },
	{ namePattern: /auditLog|auditTrail|auditCode/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail — SOX' },
	{ namePattern: /settlementDate|valueDate|clearingDate/i, regulatedAttribute: 'settlement', framework: 'financial-core', description: 'Settlement date field' },
	{ namePattern: /lateFee|penaltyAmount|chargeAmount/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge field' },
];

const JAVA_EE_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /BigDecimal\s+\w*(balance|amount|fee|rate|tax|charge|premium)/i, indicates: 'bigdecimal_monetary_field', alwaysRegulated: true },
	{ linePattern: /@Column\s*\(.*precision\s*=|@Column\s*\(.*scale\s*=/i, indicates: 'jpa_monetary_column', alwaysRegulated: true },
	{ linePattern: /EntityManager|Session\.save|em\.persist|em\.merge/i, indicates: 'jpa_persistence_operation', alwaysRegulated: false },
	{ linePattern: /@Transactional/i, indicates: 'spring_transactional_boundary', alwaysRegulated: false },
	{ linePattern: /PreparedStatement|CallableStatement|executeUpdate|executeQuery/i, indicates: 'jdbc_operation', alwaysRegulated: false },
];

const JAVA_EE_METHOD_PATTERNS: RegExp[] = [
	/calculate|compute|process/i,
	/interest|fee|charge|penalty/i,
	/settle|reconcile|clear/i,
	/audit|log.*transaction/i,
	/tax|withhold/i,
	/bill|invoice/i,
];

// ─── PL/SQL Patterns ──────────────────────────────────────────────────────────

const PLSQL_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /v_acct_bal|p_account_balance|l_balance/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance variable' },
	{ namePattern: /v_tran_amt|p_amount|l_transaction_amount/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /v_int_rate|p_interest_rate|l_rate/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate variable' },
	{ namePattern: /v_tax_amt|p_tax|l_vat/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount variable' },
	{ namePattern: /v_cust_id|p_customer_id|l_account_no/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /v_fee|p_late_fee|l_penalty/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee variable' },
	{ namePattern: /v_audit|p_audit_trail|l_audit_code/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail variable' },
];

const PLSQL_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /NUMBER\s*\(\s*\d+\s*,\s*[1-9]\d*\s*\)/i, indicates: 'decimal_monetary_type', alwaysRegulated: true },
	{ linePattern: /COMMIT\s*;|ROLLBACK\s*;/i, indicates: 'transaction_boundary', alwaysRegulated: false },
	{ linePattern: /DBMS_AUDIT_MGMT|AUDIT\s+\w+/i, indicates: 'oracle_audit_operation', alwaysRegulated: true },
	{ linePattern: /EXECUTE\s+IMMEDIATE/i, indicates: 'dynamic_sql', alwaysRegulated: false },
];

const PLSQL_PROCEDURE_PATTERNS: RegExp[] = [
	/CALC_|COMPUTE_|PROCESS_/i,
	/INTEREST|FEE|CHARGE|PENALTY/i,
	/SETTLE|RECONCILE|CLOSE_DAY/i,
	/AUDIT|LOG_TRANS/i,
	/TAX|WITHHOLD/i,
	/BILL|INVOICE/i,
];

// ─── Python 2 Patterns ────────────────────────────────────────────────────────

const PYTHON2_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /account_balance|acct_bal|balance_amount/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance variable' },
	{ namePattern: /transaction_amount|txn_amount|tran_amt/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /interest_rate|int_rate|apr/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate' },
	{ namePattern: /tax_amount|vat_amount|gst_amount/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount' },
	{ namePattern: /customer_id|client_id|account_no/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /card_number|pan_number|credit_card/i, regulatedAttribute: 'payment_card_number', framework: 'pci-dss', description: 'Payment card — PCI-DSS' },
	{ namePattern: /late_fee|penalty|charge_amount/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge' },
	{ namePattern: /audit_log|audit_trail/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail' },
];

const PYTHON2_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /from\s+decimal\s+import\s+Decimal|import\s+decimal/i, indicates: 'decimal_precision_import', alwaysRegulated: true },
	{ linePattern: /Decimal\s*\(\s*['"][\d.]+['"]\s*\)/i, indicates: 'decimal_monetary_literal', alwaysRegulated: true },
	{ linePattern: /conn\.commit\(\)|cursor\.execute\s*\(/i, indicates: 'database_transaction', alwaysRegulated: false },
	{ linePattern: /print\s+[^(]/i, indicates: 'python2_print_statement', alwaysRegulated: false },  // Python 2 indicator
];

const PYTHON2_FUNCTION_PATTERNS: RegExp[] = [
	/calculate_|compute_|process_/i,
	/interest|fee|charge|penalty/i,
	/settle|reconcile/i,
	/audit|log_transaction/i,
	/tax|withhold/i,
	/bill|invoice/i,
];

// ─── IBM RPG (AS/400) Patterns ────────────────────────────────────────────────

const RPG_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /ACCTBAL|ACCTNO|CUSTBAL|AVAILBAL/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance field' },
	{ namePattern: /TRANAMT|PAYAMT|INVAMT|CHRAMT/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /INTRAT|INTPCT|FEERAT/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate' },
	{ namePattern: /TAXAMT|VATAMT|GSTAMT/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount' },
	{ namePattern: /CUSTNO|CLNTNO|ACCTID/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /LATEFEE|PENALTY|CHRG/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge' },
	{ namePattern: /AUDIT|AUDCOD|AUDTRL/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail' },
];

const RPG_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /\d[PSB]\s+\d+\s+\d+/i, indicates: 'rpg_packed_decimal_definition', alwaysRegulated: true },  // packed decimal in RPG
	{ linePattern: /COMMIT|ROLBK/i, indicates: 'rpg_transaction_boundary', alwaysRegulated: false },
	{ linePattern: /CHAIN|READE|READP|WRITE|UPDATE|DELETE/i, indicates: 'rpg_file_operation', alwaysRegulated: false },
];

const RPG_SUBROUTINE_PATTERNS: RegExp[] = [
	/CALCFEE|CALCINT|COMPAMT/i,
	/SETTLESR|RECONSR/i,
	/AUDITSR|LOGTRN/i,
	/TAXCALC|VATCALC/i,
	/BILLCALC|INVOICSR/i,
];

// ─── NATURAL / ADABAS Patterns ────────────────────────────────────────────────

const NATURAL_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /#ACCT-BAL|#BALANCE|#AVAIL-BAL/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance' },
	{ namePattern: /#TRAN-AMT|#PAY-AMT|#AMOUNT/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /#INT-RATE|#INTEREST/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate' },
	{ namePattern: /#TAX-AMT|#VAT-AMT/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount' },
	{ namePattern: /#CUST-ID|#CLIENT-NO|#ACCOUNT-NO/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /#FEE|#LATE-FEE|#PENALTY/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge' },
	{ namePattern: /#AUDIT|#AUDIT-CODE/i, regulatedAttribute: 'audit_trail', framework: 'sox', description: 'Audit trail' },
];

const NATURAL_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /\d+N\d+\.\d+/i, indicates: 'natural_packed_numeric', alwaysRegulated: true },
	{ linePattern: /FIND\s+\w+\s+WITH|READ\s+\w+/i, indicates: 'adabas_read_operation', alwaysRegulated: false },
	{ linePattern: /STORE\s+\w+|UPDATE\s+\w+|DELETE\s+\w+/i, indicates: 'adabas_write_operation', alwaysRegulated: false },
	{ linePattern: /END-TRANSACTION|BACKOUT\s+TRANSACTION/i, indicates: 'natural_transaction_boundary', alwaysRegulated: false },
];

const NATURAL_ROUTINE_PATTERNS: RegExp[] = [
	/CALC-FEE|CALC-INT|PROC-AMT/i,
	/SETTLE|RECONCILE/i,
	/AUDIT|LOG-TRANS/i,
	/CALC-TAX|PROC-VAT/i,
	/BILL-PROC|INVOICE/i,
];

// ─── VB6 / VBA Patterns ───────────────────────────────────────────────────────

const VB6_FIELD_PATTERNS: IRegulatedFieldPattern[] = [
	{ namePattern: /dblAccountBalance|curBalance|sngBalance/i, regulatedAttribute: 'account_balance', framework: 'financial-core', description: 'Account balance' },
	{ namePattern: /dblTransAmount|curAmount|dblAmount/i, regulatedAttribute: 'transaction_amount', framework: 'financial-core', description: 'Transaction amount' },
	{ namePattern: /dblInterestRate|sngRate|dblRate/i, regulatedAttribute: 'interest_rate', framework: 'financial-core', description: 'Interest rate' },
	{ namePattern: /dblTaxAmount|curTax|dblVat/i, regulatedAttribute: 'tax_amount', framework: 'tax-compliance', description: 'Tax amount' },
	{ namePattern: /lngCustomerId|strAccountNo|lngClientId/i, regulatedAttribute: 'customer_identifier', framework: 'financial-core', description: 'Customer identifier' },
	{ namePattern: /dblLateFee|curPenalty|dblCharge/i, regulatedAttribute: 'fee_or_charge', framework: 'financial-core', description: 'Fee or charge' },
];

const VB6_STRUCTURAL_PATTERNS: IStructuralPattern[] = [
	{ linePattern: /Dim\s+\w+\s+As\s+Currency/i, indicates: 'vb6_currency_type', alwaysRegulated: true },
	{ linePattern: /Dim\s+\w+\s+As\s+Decimal/i, indicates: 'vb6_decimal_type', alwaysRegulated: true },
	{ linePattern: /\.BeginTrans|\.CommitTrans|\.RollbackTrans/i, indicates: 'ado_transaction_boundary', alwaysRegulated: false },
	{ linePattern: /On\s+Error\s+GoTo/i, indicates: 'vb6_error_handler', alwaysRegulated: false },
];

const VB6_PROC_PATTERNS: RegExp[] = [
	/CalcFee|CalcInterest|ProcessAmount/i,
	/Settle|Reconcile/i,
	/AuditLog|LogTransaction/i,
	/CalcTax|ProcessVat/i,
	/GenerateBill|CreateInvoice/i,
];


// ─── Registry ─────────────────────────────────────────────────────────────────

export const LEGACY_PATTERN_REGISTRY: Record<string, ILanguagePatterns> = {
	cobol: {
		fieldPatterns: COBOL_FIELD_PATTERNS,
		structuralPatterns: COBOL_STRUCTURAL_PATTERNS,
		paragraphPatterns: COBOL_PARAGRAPH_PATTERNS,
	},
	'java-ee': {
		fieldPatterns: JAVA_EE_FIELD_PATTERNS,
		structuralPatterns: JAVA_EE_STRUCTURAL_PATTERNS,
		paragraphPatterns: JAVA_EE_METHOD_PATTERNS,
	},
	plsql: {
		fieldPatterns: PLSQL_FIELD_PATTERNS,
		structuralPatterns: PLSQL_STRUCTURAL_PATTERNS,
		paragraphPatterns: PLSQL_PROCEDURE_PATTERNS,
	},
	python2: {
		fieldPatterns: PYTHON2_FIELD_PATTERNS,
		structuralPatterns: PYTHON2_STRUCTURAL_PATTERNS,
		paragraphPatterns: PYTHON2_FUNCTION_PATTERNS,
	},
	rpg: {
		fieldPatterns: RPG_FIELD_PATTERNS,
		structuralPatterns: RPG_STRUCTURAL_PATTERNS,
		paragraphPatterns: RPG_SUBROUTINE_PATTERNS,
	},
	natural: {
		fieldPatterns: NATURAL_FIELD_PATTERNS,
		structuralPatterns: NATURAL_STRUCTURAL_PATTERNS,
		paragraphPatterns: NATURAL_ROUTINE_PATTERNS,
	},
	vb6: {
		fieldPatterns: VB6_FIELD_PATTERNS,
		structuralPatterns: VB6_STRUCTURAL_PATTERNS,
		paragraphPatterns: VB6_PROC_PATTERNS,
	},
};

/**
 * Match threshold for COMP-3 field names when no name pattern matches.
 * If a field has COMP-3 clause, it is regulated by default.
 */
export const COMP3_DEFAULT_ATTRIBUTE = 'packed_decimal_financial_field';
export const COMP3_DEFAULT_FRAMEWORK = 'financial-core';
