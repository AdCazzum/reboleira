import { z } from 'zod';
export const themeSchema = z.object({
  fontScale: z.number().min(0.5).max(3),
  contrast: z.enum(['normal','high']),
  font: z.enum(['system','dyslexic','serif']),
  lineSpacing: z.number().min(1).max(3),
  colorMode: z.enum(['light','dark','auto']),
  density: z.enum(['comfortable','compact'])
});
const item = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('list'), items: z.array(z.string()) }),
  z.object({ type: z.literal('image'), refId: z.string() }),
  z.object({ type: z.literal('action'), refId: z.string(), label: z.string() })
]);
export const uiSpecSchema = z.object({
  theme: themeSchema,
  language: z.string(),
  readingLevel: z.enum(['simple','standard','expert']),
  sections: z.array(z.object({
    role: z.enum(['primary','summary','content','actions','navigation','aside','hidden']),
    priority: z.number(), heading: z.string().optional(),
    content: z.array(item), sourceRefs: z.array(z.string())
  })),
  hidden: z.array(z.string())
});
