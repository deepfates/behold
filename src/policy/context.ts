// Compatibility surface for callers that historically treated model context
// as controller policy. The projection itself is mind-neutral and is shared by
// live requests and disposable Lync folds.
export {
  projectCurrentModelObservation,
  projectHistoricalModelObservation,
  projectRecentActionContinuity,
  projectResidentWorkingContinuity,
  RESIDENT_WORKING_CONTINUITY_PROTOCOL,
  type RecentActionContinuity,
  type ResidentWorkingContinuity,
} from '../mind/observation-context';
