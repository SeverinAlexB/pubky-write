import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useEffect, useState } from "react";
import { Menu } from "../components/Menu.tsx";
import { documentStats, formatCount, type TextStats } from "./textStats.ts";

/** What the live word count shows. */
export type LiveCountMetric = keyof TextStats;
export type LiveCountSetting = { visible: boolean; metric: LiveCountMetric };

/** Singular and plural units for the live count, e.g. "1 word", "3 of 12 words". */
const metricUnits: Record<LiveCountMetric, [string, string]> = {
  words: ["word", "words"],
  characters: ["character", "characters"],
  charactersExcludingSpaces: ["character excluding spaces", "characters excluding spaces"],
};

const VISIBLE_SETTING = "docs.wordCountVisible";
const METRIC_SETTING = "docs.wordCountMetric";

const metricLabels: Record<LiveCountMetric, string> = {
  words: "Words",
  characters: "Characters",
  charactersExcludingSpaces: "Characters excluding spaces",
};

/** The live word count setting, remembered in the browser. */
export function useLiveCountSetting(): [LiveCountSetting, (setting: LiveCountSetting) => void] {
  const [setting, setSetting] = useState<LiveCountSetting>(() => {
    const metric = localStorage.getItem(METRIC_SETTING);
    return {
      visible: localStorage.getItem(VISIBLE_SETTING) === "true",
      metric: metric && metric in metricLabels ? (metric as LiveCountMetric) : "words",
    };
  });
  useEffect(() => {
    localStorage.setItem(VISIBLE_SETTING, String(setting.visible));
    localStorage.setItem(METRIC_SETTING, setting.metric);
  }, [setting]);
  return [setting, setSetting];
}

/** The live count at the bottom left of the editor area; its menu switches the value or hides it. */
export function LiveWordCount({
  editor,
  setting,
  onChange,
}: {
  editor: Editor;
  setting: LiveCountSetting;
  onChange: (setting: LiveCountSetting) => void;
}) {
  const text = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const value = formatCount(documentStats(current.state), setting.metric);
      const [singular, plural] = metricUnits[setting.metric];
      return `${value} ${value === "1" ? singular : plural}`;
    },
  });
  return (
    <div className="live-word-count">
      <Menu
        label={text}
        buttonClassName="live-word-count-button"
        listClassName="live-word-count-menu"
        entries={[
          ...(Object.keys(metricLabels) as LiveCountMetric[]).map((metric) => ({
            label: metricLabels[metric],
            checked: setting.metric === metric,
            onSelect: () => onChange({ ...setting, metric }),
          })),
          "separator",
          { label: "Hide word count", onSelect: () => onChange({ ...setting, visible: false }) },
        ]}
      />
    </div>
  );
}
