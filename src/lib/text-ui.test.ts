import { describe, expect, it } from "vitest";

import { textUi } from "@/lib/text-ui";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { experimentUi } from "@/modules/experiments/constants/experiment-ui";
import { modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";
import { documentsUi } from "@/modules/datasets/constants/documents-ui";

describe("shared typography scale", () => {
  it("exposes the expected scale keys", () => {
    expect(Object.keys(textUi).sort()).toEqual(
      ["body", "detailTitle", "label", "metric", "section", "subheading", "title"].sort()
    );
  });

  it("is the single source every module *Ui delegates to (no drift)", () => {
    for (const ui of [taskUi, datasetUi, experimentUi, modelRegistryUi, documentsUi]) {
      expect(ui).toBe(textUi);
    }
  });
});
