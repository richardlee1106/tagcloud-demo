import { analyzeCompare } from '../agents/compare-agent.js'
import { analyzeCoverageGap } from '../agents/coverage-gap-agent.js'
import { analyzeDominantIndustry } from '../agents/dominant-industry-agent.js'
import { analyzeHotspots } from '../agents/hotspot-agent.js'
import { analyzeOpportunities } from '../agents/opportunity-agent.js'
import { createSpecialistRegistry } from './specialist-registry.js'

const DEFAULT_SPECIALIST_DEFINITIONS = [
  {
    id: 'dominant_industries',
    supports_objectives: ['*'],
    run: ({ groundingResult }) => analyzeDominantIndustry({ groundingResult })
  },
  {
    id: 'hotspots',
    supports_objectives: ['*'],
    run: ({ groundingResult, objectiveContract }) => analyzeHotspots({ groundingResult, objectiveContract })
  },
  {
    id: 'opportunity_points',
    supports_objectives: ['*'],
    run: ({ groundingResult, objectiveContract }) => analyzeOpportunities({ groundingResult, objectiveContract })
  },
  {
    id: 'comparison',
    supports_objectives: ['*'],
    run: ({ groundingResult, objectiveContract }) => analyzeCompare({ groundingResult, objectiveContract })
  },
  {
    id: 'coverage_gap',
    supports_objectives: ['*'],
    run: ({ groundingResult, objectiveContract }) => analyzeCoverageGap({ groundingResult, objectiveContract })
  }
]

let singletonRegistry = null

export function createDefaultSpecialistRegistry() {
  return createSpecialistRegistry({
    definitions: DEFAULT_SPECIALIST_DEFINITIONS
  })
}

function getDefaultRegistry() {
  if (!singletonRegistry) {
    singletonRegistry = createDefaultSpecialistRegistry()
  }
  return singletonRegistry
}

export const KNOWN_SPECIALISTS = createDefaultSpecialistRegistry().listKnownSpecialists()

export function runSpecialistTask(task = {}, { specialistRegistry = null } = {}) {
  const registry = specialistRegistry ?? getDefaultRegistry()
  return registry.runTask(task)
}
