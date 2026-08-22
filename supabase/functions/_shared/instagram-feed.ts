export function buildImageContainerFields(input: {
  imageUrl: string;
  altText?: string;
  caption?: string;
  isCarouselItem?: boolean;
  mediaType?: "STORIES";
}) {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) throw new Error("Instagram image URL is missing");
  return {
    image_url: imageUrl,
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.altText ? { alt_text: input.altText } : {}),
    ...(input.isCarouselItem ? { is_carousel_item: true } : {}),
    ...(input.mediaType ? { media_type: input.mediaType } : {}),
  };
}

export function buildCarouselContainerFields(input: {
  children: string[];
  caption: string;
}) {
  if (input.children.length < 2 || input.children.length > 10) {
    throw new Error("Instagram carousels require 2–10 child containers");
  }
  if (input.children.some((value) => !value.trim())) {
    throw new Error("Instagram carousel child container is missing");
  }
  return {
    media_type: "CAROUSEL",
    children: input.children.join(","),
    caption: input.caption,
  };
}
