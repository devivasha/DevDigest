import { config } from '@devdigest/api/config'

export interface PipelineResult {
  summary: string
}

export async function runPipeline(input: string): Promise<PipelineResult> {
  return { summary: `[${config.port}] ${input.slice(0, 100)}` }
}
