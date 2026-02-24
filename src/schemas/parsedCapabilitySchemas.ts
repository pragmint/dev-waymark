import { z } from 'zod';

const CapabilityRelationshipSchema = z.enum(['upstream', 'downstream', 'related']);

const NuanceItemSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

const AssessmentRatingSchema = z.object({
  rating: z.number().min(1).max(4),
  title: z.string().min(1),
  description: z.string().min(1),
  dimension: z.string().optional(),
});

const SupportingPracticeSchema = z.object({
  id: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().min(1),
});

const LinkedCapabilitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  relationship: CapabilityRelationshipSchema,
  description: z.string().min(1),
});

export const ParsedCapabilitySchema = z.object({
  title: z.string().min(1),
  doraLink: z.url(),
  introduction: z.string().min(1),
  nuances: z.object({
    introduction: z.string().min(1),
    items: z.array(NuanceItemSchema).min(1).max(10),
  }),
  assessment: z.object({
    intro: z.string().min(1),
    outro: z.string().min(1),
    ratings: z.array(AssessmentRatingSchema).min(4),
  }),
  supporting_practices: z.object({
    intro: z.string().min(1),
    practices: z.array(SupportingPracticeSchema).min(1),
  }),
  linked_capabilities: z.array(LinkedCapabilitySchema).min(1),
});

export type ParsedCapability = z.infer<typeof ParsedCapabilitySchema>;
