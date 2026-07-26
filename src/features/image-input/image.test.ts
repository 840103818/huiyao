import { afterEach, describe, expect, it, vi } from "vitest";
import { revokePreparedImagePreview } from "./image";

afterEach(() => vi.restoreAllMocks());

describe("revokePreparedImagePreview", () => {
  it("releases only locally allocated Blob preview URLs", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    revokePreparedImagePreview({ previewUrl: "blob:preview-1" });
    revokePreparedImagePreview({ previewUrl: "data:image/jpeg;base64,thumb" });
    revokePreparedImagePreview(undefined);

    expect(revoke).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:preview-1");
  });
});
