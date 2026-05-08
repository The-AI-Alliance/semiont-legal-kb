/**
 * Tag schemas owned by semiont-legal-kb.
 *
 * Schemas are runtime-registered per KB via `frame.addTagSchema(...)`.
 * The `register-tag-schemas` skill registers all of them at once for KB
 * bootstrap. Skills that use a specific schema can also self-register
 * idempotently at startup.
 */

import type { TagSchema } from '@semiont/sdk';

export const LEGAL_IRAC_SCHEMA: TagSchema = {
  id: 'legal-irac',
  name: 'Legal Analysis (IRAC)',
  description: 'Issue, Rule, Application, Conclusion framework for legal reasoning',
  domain: 'legal',
  tags: [
    {
      name: 'Issue',
      description: 'The legal question or problem to be resolved',
      examples: [
        'What is the central legal question?',
        'What must the court decide?',
        'What is the dispute about?',
      ],
    },
    {
      name: 'Rule',
      description: 'The relevant law, statute, or legal principle',
      examples: [
        'What law applies?',
        'What is the legal standard?',
        'What statute governs this case?',
      ],
    },
    {
      name: 'Application',
      description: 'How the rule applies to the specific facts',
      examples: [
        'How does the law apply to these facts?',
        'Analysis of the case',
        'How do the facts satisfy the legal standard?',
      ],
    },
    {
      name: 'Conclusion',
      description: 'The resolution or outcome based on the analysis',
      examples: [
        "What is the court's decision?",
        'What is the final judgment?',
        'What is the holding?',
      ],
    },
  ],
};

export const ARGUMENT_TOULMIN_SCHEMA: TagSchema = {
  id: 'argument-toulmin',
  name: 'Argument Structure (Toulmin)',
  description: 'Claim, Evidence, Warrant, Counterargument, Rebuttal framework for argumentation',
  domain: 'general',
  tags: [
    {
      name: 'Claim',
      description: 'The main assertion or thesis',
      examples: [
        'What is being argued?',
        'What is the main point?',
        'What position is being taken?',
      ],
    },
    {
      name: 'Evidence',
      description: 'Data or facts supporting the claim',
      examples: [
        'What supports this claim?',
        'What are the facts?',
        'What data is provided?',
      ],
    },
    {
      name: 'Warrant',
      description: 'Reasoning connecting evidence to claim',
      examples: [
        'Why does this evidence support the claim?',
        'What is the logic?',
        'How does this reasoning work?',
      ],
    },
    {
      name: 'Counterargument',
      description: 'Opposing viewpoints or objections',
      examples: [
        'What are the objections?',
        'What do critics say?',
        'What are alternative views?',
      ],
    },
    {
      name: 'Rebuttal',
      description: 'Response to counterarguments',
      examples: [
        'How is the objection addressed?',
        'Why is the counterargument wrong?',
        'How is the criticism answered?',
      ],
    },
  ],
};

export const ALL_SCHEMAS: TagSchema[] = [
  LEGAL_IRAC_SCHEMA,
  ARGUMENT_TOULMIN_SCHEMA,
];
