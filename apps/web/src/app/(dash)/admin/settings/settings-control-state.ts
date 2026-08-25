export interface SettingsControlActionState {
  status: "idle" | "success" | "warning" | "error";
  code:
    | "applied"
    | "applied_cache_warning"
    | "abandoned"
    | "rollback_created"
    | "stale"
    | "rollback_conflict"
    | "invalid"
    | "failed"
    | null;
}

export const INITIAL_SETTINGS_CONTROL_ACTION_STATE: SettingsControlActionState = {
  status: "idle",
  code: null,
};
