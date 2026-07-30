"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ComposerStateMachine,
  composerSelectionsEqual,
  type ComposerSelectionState,
  type ComposerTransition,
} from "@/features/chat/model/composerState";
import {
  LatestSnapshotWriter,
  type ComposerSyncStatus,
} from "@/features/chat/model/composerPersistence";

interface UseComposerCoordinatorOptions {
  conversationId: string | null;
  initialState: ComposerSelectionState;
  persistSnapshot: (conversationId: string, snapshot: ComposerSelectionState) => Promise<void>;
}

export function useComposerCoordinator({
  conversationId,
  initialState,
  persistSnapshot,
}: UseComposerCoordinatorOptions) {
  const [machine] = useState(() => new ComposerStateMachine(initialState));
  const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot, machine.getSnapshot);

  const [syncStatus, setSyncStatus] = useState<ComposerSyncStatus>("idle");
  const [writer] = useState(() => new LatestSnapshotWriter({
    scopeId: conversationId,
    initialSnapshot: initialState,
    equals: composerSelectionsEqual,
    write: persistSnapshot,
    onStatusChange: setSyncStatus,
  }));

  useEffect(() => writer.setWrite(persistSnapshot), [persistSnapshot, writer]);

  useEffect(() => {
    writer.resume();
    return () => writer.dispose();
  }, [writer]);

  const dispatch = (transition: ComposerTransition) => {
    const previous = machine.getSnapshot();
    const next = machine.dispatch(transition);
    if (next !== previous) writer.update(next);
    return next;
  };

  return {
    state,
    syncStatus,
    dispatch,
    getSnapshot: machine.getSnapshot,
    adoptConversation: (newConversationId: string, persistedSnapshot: ComposerSelectionState) => {
      writer.adoptScope(newConversationId, persistedSnapshot);
    },
    retry: () => writer.retry(),
  };
}
