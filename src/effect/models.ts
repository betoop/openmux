/**
 * Domain models using Zod for validation and serialization.
 * Replaces Effect Schema.Class with Zod schemas.
 */
import { z } from 'zod';
import {
  PtyIdSchema,
  WorkspaceIdSchema,
  SessionIdSchema,
  ColsSchema,
  RowsSchema,
  LayoutModeSchema,
  type WorkspaceId,
} from './types';

/** Rectangle dimensions for pane positioning */
export const RectangleSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type Rectangle = z.infer<typeof RectangleSchema> & {
  /** Check if a point is within this rectangle */
  contains(px: number, py: number): boolean;
};

/** Create a Rectangle with the contains method */
export const createRectangle = (data: Omit<Rectangle, 'contains'>): Rectangle => ({
  ...data,
  contains(px: number, py: number): boolean {
    return px >= this.x && px < this.x + this.width && py >= this.y && py < this.y + this.height;
  },
});
/** PTY session information */
export const PtySessionSchema = z.object({
  id: PtyIdSchema,
  pid: z.number().int(),
  cols: ColsSchema,
  rows: RowsSchema,
  cwd: z.string(),
  shell: z.string(),
  title: z.string().optional(),
  lastCommand: z.string().optional(),
});

export type PtySession = z.infer<typeof PtySessionSchema>;

/** Serialized pane data for persistence */
export const SerializedPaneDataSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  cwd: z.string(),
});

export type SerializedPaneData = z.infer<typeof SerializedPaneDataSchema>;

/** Serialized split node for persistence */
export const SerializedSplitNodeSchema: z.ZodType<SerializedSplitNode> = z.object({
  type: z.literal('split'),
  id: z.string(),
  direction: z.enum(['horizontal', 'vertical']),
  ratio: z.number(),
  first: z.lazy(() => SerializedLayoutNodeSchema),
  second: z.lazy(() => SerializedLayoutNodeSchema),
});

export type SerializedSplitNode = {
  type: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: SerializedLayoutNode;
  second: SerializedLayoutNode;
};

/** Serializable layout node types */
export const SerializedLayoutNodeSchema: z.ZodType<SerializedLayoutNode> = z.union([
  SerializedPaneDataSchema,
  SerializedSplitNodeSchema,
]);

export type SerializedLayoutNode = SerializedPaneData | SerializedSplitNode;

/** Serialized workspace for persistence */
export const SerializedWorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  label: z.string().optional(),
  mainPane: SerializedLayoutNodeSchema.nullable(),
  stackPanes: z.array(SerializedLayoutNodeSchema),
  focusedPaneId: z.string().nullable(),
  activeStackIndex: z.number().int(),
  lastFocusedPaneIds: z.array(z.string().nullable()).default([]),
  layoutMode: LayoutModeSchema,
  zoomed: z.boolean(),
});

export type SerializedWorkspace = z.infer<typeof SerializedWorkspaceSchema>;

/** Session metadata for listing */
export const SessionMetadataSchema = z.object({
  id: SessionIdSchema,
  name: z.string(),
  createdAt: z.number(),
  lastSwitchedAt: z.number(),
  autoNamed: z.boolean(),
});

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

/** Full serialized session for persistence */
export const SerializedSessionSchema = z.object({
  metadata: SessionMetadataSchema,
  workspaces: z.array(SerializedWorkspaceSchema),
  activeWorkspaceId: WorkspaceIdSchema,
});

export type SerializedSession = z.infer<typeof SerializedSessionSchema>;

/** Session index for tracking all sessions */
export const SessionIndexSchema = z.object({
  sessions: z.array(SessionMetadataSchema),
  activeSessionId: SessionIdSchema.nullable(),
  aggregateSessionOrder: z.array(SessionIdSchema).optional(),
});

export type SessionIndex = z.infer<typeof SessionIndexSchema>;

/** Create an empty session index */
export const createEmptySessionIndex = (): SessionIndex => ({
  sessions: [],
  activeSessionId: null,
  aggregateSessionOrder: [],
});

/** Template pane definition for layout templates */
export const TemplatePaneDataSchema = z.object({
  role: z.enum(['main', 'stack']),
  cwd: z.string().optional(),
  command: z.string().optional(),
});

export type TemplatePaneData = z.infer<typeof TemplatePaneDataSchema>;

/** Template layout pane definition for split layouts */
export const TemplateLayoutPaneSchema = z.object({
  type: z.literal('pane'),
  cwd: z.string().optional(),
  command: z.string().optional(),
});

export type TemplateLayoutPane = z.infer<typeof TemplateLayoutPaneSchema>;

/** Template layout split definition */
export const TemplateLayoutSplitSchema: z.ZodType<TemplateLayoutSplit> = z.object({
  type: z.literal('split'),
  direction: z.enum(['horizontal', 'vertical']),
  ratio: z.number(),
  first: z.lazy(() => TemplateLayoutNodeSchema),
  second: z.lazy(() => TemplateLayoutNodeSchema),
});

export type TemplateLayoutSplit = {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: TemplateLayoutNode;
  second: TemplateLayoutNode;
};

/** Template layout node */
export const TemplateLayoutNodeSchema: z.ZodType<TemplateLayoutNode> = z.union([
  TemplateLayoutPaneSchema,
  TemplateLayoutSplitSchema,
]);

export type TemplateLayoutNode = TemplateLayoutPane | TemplateLayoutSplit;

/** Template workspace layout definition */
export const TemplateWorkspaceLayoutSchema = z.object({
  main: TemplateLayoutNodeSchema.nullable(),
  stack: z.array(TemplateLayoutNodeSchema),
});

export type TemplateWorkspaceLayout = z.infer<typeof TemplateWorkspaceLayoutSchema>;

/** Template workspace definition */
export const TemplateWorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  label: z.string().optional(),
  layoutMode: LayoutModeSchema,
  panes: z.array(TemplatePaneDataSchema).optional(),
  layout: TemplateWorkspaceLayoutSchema.optional(),
});

export type TemplateWorkspace = z.infer<typeof TemplateWorkspaceSchema>;

/** Template defaults for workspace/pane counts */
export const TemplateDefaultsSchema = z.object({
  workspaceCount: z.number().int().min(1).max(9),
  paneCount: z.number().int().positive(),
  layoutMode: LayoutModeSchema,
  cwd: z.string().optional(),
});

export type TemplateDefaults = z.infer<typeof TemplateDefaultsSchema>;

/** Full template session definition */
export const TemplateSessionSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  defaults: TemplateDefaultsSchema,
  workspaces: z.array(TemplateWorkspaceSchema),
});

export type TemplateSession = z.infer<typeof TemplateSessionSchema>;

/** Factory function for TemplateLayoutSplit */
export function createTemplateLayoutSplit(
  data: Omit<TemplateLayoutSplit, 'type'>
): TemplateLayoutSplit {
  return {
    type: 'split',
    ...data,
  };
}

/** Factory function for TemplateLayoutPane */
export function createTemplateLayoutPane(
  data: Omit<TemplateLayoutPane, 'type'>
): TemplateLayoutPane {
  return {
    type: 'pane',
    ...data,
  };
}

/** Factory function for TemplateWorkspace */
export function createTemplateWorkspace(
  data: Omit<TemplateWorkspace, 'id'> & { id?: WorkspaceId }
): TemplateWorkspace {
  return {
    id: data.id ?? (1 as WorkspaceId),
    label: data.label,
    layoutMode: data.layoutMode,
    panes: data.panes,
    layout: data.layout,
  };
}

/** Factory function for TemplateDefaults */
export function createTemplateDefaults(data: Partial<TemplateDefaults>): TemplateDefaults {
  return {
    workspaceCount: data.workspaceCount ?? 1,
    paneCount: data.paneCount ?? 1,
    layoutMode: data.layoutMode ?? 'vertical',
    cwd: data.cwd,
  };
}

/** Factory function for TemplateSession */
export function createTemplateSession(
  data: Omit<TemplateSession, 'version'> & { version?: 1 }
): TemplateSession {
  return {
    version: data.version ?? 1,
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    defaults: data.defaults,
    workspaces: data.workspaces,
  };
}

/** Factory function for TemplatePaneData */
export function createTemplatePaneData(data: Partial<TemplatePaneData>): TemplatePaneData {
  return {
    role: data.role ?? 'stack',
    cwd: data.cwd,
    command: data.command,
  };
}

/** Factory function for TemplateWorkspaceLayout */
export function createTemplateWorkspaceLayout(
  data: Partial<TemplateWorkspaceLayout>
): TemplateWorkspaceLayout {
  return {
    main: data.main ?? null,
    stack: data.stack ?? [],
  };
}
