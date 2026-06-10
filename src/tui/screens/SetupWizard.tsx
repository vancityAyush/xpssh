import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Select } from "@inkjs/ui";
import TextInput from "ink-text-input";
import { PROVIDERS, getProvider } from "../../core/providers/index.js";
import {
  executeSetupPipeline,
  resolveSetupPlan,
  setupSteps,
  type SetupArgs,
  type SetupPlan,
} from "../../commands/setup.js";
import { clonePrefix } from "../../core/profile.js";
import { useStore } from "../store.js";
import { useCommandDispatch } from "../dispatch.js";
import { StepList, type StepRow } from "../components/StepList.js";

type Stage = "provider" | "name" | "email" | "delivery" | "review" | "running" | "finished";

const EMPTY_ARGS: SetupArgs = { noBrowser: false, noClipboard: false, noAgent: false, force: false };

/** First stage whose input the prefilled args don't already answer. */
function firstStage(args: SetupArgs): Stage {
  if (!args.provider || !getProvider(args.provider)) return "provider";
  if (!args.name) return "name";
  if (!args.email) return "email";
  return "review";
}

export function SetupWizard() {
  const { state, dispatch } = useStore();
  const { makeContext, refreshProfiles } = useCommandDispatch();

  const initialArgs = state.setupPrefill ?? EMPTY_ARGS;
  const [args, setArgs] = useState<SetupArgs>(initialArgs);
  const [stage, setStage] = useState<Stage>(() => firstStage(initialArgs));
  const [text, setText] = useState("");
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [plan, setPlan] = useState<SetupPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const interactive = state.focusZone === "screen" && !state.prompt && !state.busy;
  const provider = args.provider ? getProvider(args.provider) : undefined;

  useInput(
    (_input, key) => {
      if (!key.escape) return;
      if (stage === "running") return; // pipeline owns the screen
      dispatch({ type: "set-setup-prefill", args: null });
      dispatch({ type: "navigate", screen: "dashboard" });
    },
    { isActive: interactive },
  );

  const stepRows = useMemo(
    () => setupSteps.map((s) => ({ id: s.id, label: s.label, status: "pending" as const })),
    [],
  );

  async function start() {
    setStage("running");
    setSteps(stepRows);
    setError(null);
    const ctx = makeContext(false, (event) => {
      if (event.type !== "step") return;
      setSteps((current) =>
        current.map((row) =>
          row.id === event.id
            ? { ...row, status: event.status === "start" ? "running" : event.status === "done" ? "done" : "failed" }
            : row,
        ),
      );
    });
    dispatch({ type: "set-busy", busy: true });
    try {
      const resolved = await resolveSetupPlan(args, ctx);
      setPlan(resolved);
      await executeSetupPipeline(resolved, ctx);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      dispatch({ type: "set-busy", busy: false });
      dispatch({ type: "set-prompt", prompt: null });
      await refreshProfiles();
      setStage("finished");
    }
  }

  return (
    <Box flexDirection="column" paddingX={1} gap={1}>
      <Text bold>Set up a new SSH key{provider ? ` — ${provider.label}` : ""}</Text>

      {stage === "provider" && (
        <Select
          isDisabled={!interactive}
          options={PROVIDERS.map((p) => ({ label: p.label, value: p.id }))}
          onChange={(id) => {
            setArgs((a) => ({ ...a, provider: id }));
            setStage(firstStage({ ...args, provider: id }));
          }}
        />
      )}

      {stage === "name" && (
        <Box flexDirection="column">
          <Text>Profile name for this account (e.g. personal, work)</Text>
          <Box>
            <Text color="cyan">→ </Text>
            <TextInput
              value={text}
              onChange={setText}
              focus={interactive}
              placeholder="personal"
              onSubmit={(value) => {
                const name = value.trim() || "personal";
                setText("");
                setArgs((a) => ({ ...a, name }));
                setStage(firstStage({ ...args, name }));
              }}
            />
          </Box>
        </Box>
      )}

      {stage === "email" && (
        <Box flexDirection="column">
          <Text>Email for the key comment</Text>
          <Box>
            <Text color="cyan">→ </Text>
            <TextInput
              value={text}
              onChange={setText}
              focus={interactive}
              placeholder="you@example.com"
              onSubmit={(value) => {
                if (!value.includes("@")) return;
                setText("");
                setArgs((a) => ({ ...a, email: value.trim() }));
                setStage("delivery");
              }}
            />
          </Box>
        </Box>
      )}

      {stage === "delivery" && (
        <Box flexDirection="column">
          <Text>How should the public key reach {provider?.label}?</Text>
          <Select
            isDisabled={!interactive}
            options={[
              { label: "Clipboard + open settings page (manual paste)", value: "manual" },
              ...(provider?.api
                ? [{ label: `Upload via API token (${provider.api.tokenEnvVar})`, value: "token" }]
                : []),
            ]}
            onChange={(choice) => {
              if (choice === "token") {
                setStage("review");
                // token comes from env or a secret prompt mid-pipeline
                setArgs((a) => ({ ...a, token: a.token ?? process.env[provider!.api!.tokenEnvVar] }));
              } else {
                setStage("review");
              }
            }}
          />
        </Box>
      )}

      {stage === "review" && (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>
              provider <Text bold>{provider?.label}</Text> · profile <Text bold>{args.name}</Text> · email{" "}
              <Text bold>{args.email}</Text>
            </Text>
            <Text dimColor>
              key {args.keyType ?? provider?.keyType} · delivery {args.token ? "API upload" : "clipboard + browser"}
            </Text>
          </Box>
          <Select
            isDisabled={!interactive}
            options={[
              { label: "▶ Create the key", value: "go" },
              { label: "Cancel", value: "cancel" },
            ]}
            onChange={(choice) => {
              if (choice === "go") void start();
              else {
                dispatch({ type: "set-setup-prefill", args: null });
                dispatch({ type: "navigate", screen: "dashboard" });
              }
            }}
          />
        </Box>
      )}

      {(stage === "running" || stage === "finished") && (
        <Box flexDirection="column" gap={1}>
          <StepList steps={steps} />
          {error && <Text color="red">✗ {error}</Text>}
          {stage === "finished" && !error && plan && (
            <Text color="green">
              ✓ Clone with {clonePrefix(plan, plan.provider.sshUser)}
              {"<owner>/<repo>.git"}
            </Text>
          )}
          {stage === "finished" && (
            <Select
              isDisabled={!interactive}
              options={[
                { label: "Back to dashboard", value: "dashboard" },
                ...(plan && error ? [{ label: "Retry", value: "retry" }] : []),
              ]}
              onChange={(choice) => {
                if (choice === "retry") void start();
                else {
                  dispatch({ type: "set-setup-prefill", args: null });
                  dispatch({ type: "navigate", screen: "dashboard" });
                }
              }}
            />
          )}
        </Box>
      )}

      {stage !== "running" && stage !== "finished" && <Text dimColor>esc to cancel</Text>}
    </Box>
  );
}
