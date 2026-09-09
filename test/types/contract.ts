// Q5's hard requirement, checked by the compiler rather than at runtime.
//
// This file imports the GENERATED declarations, not `src/`, so it fails if the
// published type surface changes shape - not merely if the source does. It is
// type-checked by `npm run typecheck` (tsconfig.contract.json) and never run.
//
// Everything is exported so `noUnusedLocals`-style rules stay quiet; nothing
// here has a runtime purpose.
import type { Plugin } from 'vite'
import sriDefault, { sri as sriNamed } from '../../types/index.js'
import type { SriHashAlgorithm, SriOptions } from '../../types/index.js'

// --- the two exported entry points, both returning a Vite Plugin -------------
export const fromDefault: Plugin = sriDefault()
export const fromNamed: Plugin = sriNamed()
export const withEmptyOptions: Plugin = sriDefault({})

// --- SriHashAlgorithm is exactly the three SRI algorithms --------------------
export const sha256: SriHashAlgorithm = 'sha256'
export const sha384: SriHashAlgorithm = 'sha384'
export const sha512: SriHashAlgorithm = 'sha512'
// @ts-expect-error sha1 is not an SRI algorithm and must stay rejected
export const sha1: SriHashAlgorithm = 'sha1'

// --- every option, exactly: a removed field fails as an excess property, an
// --- added field fails as a missing one ------------------------------------
export const everyOption: Required<SriOptions> = {
  hashAlgorithm: 'sha512',
  crossorigin: 'use-credentials',
  bypassDomains: ['cdn.example.com'],
  trustDomains: ['assets.example.com'],
  ignoreMissingAsset: true,
  logLevel: 'debug',
  importmap: true,
  manifest: true
}

// --- the inline unions, pinned independently of how they are spelled --------
export const crossoriginAnonymous: SriOptions['crossorigin'] = 'anonymous'
export const crossoriginCredentials: SriOptions['crossorigin'] = 'use-credentials'
// @ts-expect-error `same-origin` is not a crossorigin value SRI can verify
export const crossoriginBad: SriOptions['crossorigin'] = 'same-origin'

export const logLevels: SriOptions['logLevel'][] = ['silent', 'error', 'warn', 'info', 'debug']
// @ts-expect-error `verbose` is not one of the five levels
export const logLevelBad: SriOptions['logLevel'] = 'verbose'

// --- every option stays optional -------------------------------------------
export const noOptions: SriOptions = {}

// --- and the scalar field types themselves ---------------------------------
export const domains: string[] | undefined = everyOption.bypassDomains
export const flag: boolean | undefined = everyOption.manifest
