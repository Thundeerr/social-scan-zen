import { describe, expect, it } from "vitest";
import {
  buildCarouselContainerFields,
  buildImageContainerFields,
} from "../../supabase/functions/_shared/instagram-feed";

describe("Instagram feed container fields", () => {
  it("builds an accessible image carousel child", () => {
    expect(
      buildImageContainerFields({
        imageUrl: "https://storage.example/01.jpg?token=secret",
        altText: "FollowerStar audit slide",
        isCarouselItem: true,
      }),
    ).toEqual({
      image_url: "https://storage.example/01.jpg?token=secret",
      alt_text: "FollowerStar audit slide",
      is_carousel_item: true,
    });
  });

  it("preserves carousel order in the parent container", () => {
    expect(
      buildCarouselContainerFields({ children: ["child-1", "child-2"], caption: "Caption" }),
    ).toEqual({ media_type: "CAROUSEL", children: "child-1,child-2", caption: "Caption" });
  });

  it("rejects an invalid carousel child count", () => {
    expect(() => buildCarouselContainerFields({ children: ["only-one"], caption: "x" })).toThrow(
      "2–10",
    );
  });
});
