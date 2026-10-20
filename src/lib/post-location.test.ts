import { expect, test } from "vitest";
import { applyPostLocation } from "../../supabase/functions/_shared/instagram-feed";

test("adds the location id to posts", () => {
  expect(applyPostLocation({ caption: "x" }, "123456")).toEqual({ caption: "x", location_id: "123456" });
});
test("leaves posts untagged when no location is set", () => {
  expect(applyPostLocation({ caption: "x" }, "")).toEqual({ caption: "x" });
});
test("rejects non-numeric location ids", () => {
  expect(() => applyPostLocation({}, "USA")).toThrow();
});
