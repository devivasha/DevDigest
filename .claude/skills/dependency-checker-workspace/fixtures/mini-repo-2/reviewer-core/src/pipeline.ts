import { engineName } from './meta'

export interface PipelineResult {
  summary: string
  engine: string
}

export async function runPipeline(input: string): Promise<PipelineResult> {
  return { summary: input.slice(0, 100), engine: engineName }
}
