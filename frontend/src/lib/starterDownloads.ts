import type { DownloadJob, StarterModelState } from "@latent/shared";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";

/**
 * Require an explicit acknowledgement before fetching weights with additional
 * license terms. One pack download shows one prompt per unique license.
 */
async function acceptRequiredLicenses(models: StarterModelState[]): Promise<boolean> {
  const licenses = new Map<string, NonNullable<StarterModelState["license"]>>();
  for (const model of models) {
    const license = model.license;
    if (license?.requiresAcceptance) licenses.set(`${license.url}|${license.version ?? ""}`, license);
  }

  for (const license of licenses.values()) {
    const accepted = await confirm({
      title: `Accept ${license.name}?`,
      body: `Review ${license.url}. By continuing, you confirm that you have read and agree to ${license.name}${license.version ? ` (${license.version})` : ""}.`,
      confirmLabel: "Agree & download",
    });
    if (!accepted) return false;
  }
  return true;
}

export async function startStarterModel(model: StarterModelState): Promise<DownloadJob | null> {
  if (!(await acceptRequiredLicenses([model]))) return null;
  return api.startStarterDownload(model.id, Boolean(model.license?.requiresAcceptance));
}

export async function startStarterPack(
  models: StarterModelState[],
): Promise<PromiseSettledResult<DownloadJob>[] | null> {
  if (!(await acceptRequiredLicenses(models))) return null;
  return Promise.allSettled(
    models.map((model) =>
      api.startStarterDownload(model.id, Boolean(model.license?.requiresAcceptance)),
    ),
  );
}
