// Compatibility surface for callers that historically treated model context
// as controller policy. The projection itself is mind-neutral and is shared by
// live requests and disposable Lync folds.
export {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
  projectRecentActionContinuity,
  projectResidentWorkingContinuity,
  projectResidentFactualContinuity,
  RESIDENT_FACTUAL_CONTINUITY_PROTOCOL,
  RESIDENT_WORKING_CONTINUITY_PROTOCOL,
  type RecentActionContinuity,
  type ResidentWorkingContinuity,
  type ResidentFactualContinuity,
} from '../mind/observation-context';
