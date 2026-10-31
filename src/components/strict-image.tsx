import { getImageProps, type ImageProps } from "next/image";

/** `next/image` always adds an inline style, which the page CSP does not allow. */
export function StrictImage(props: ImageProps) {
  const { style: _inlineStyle, ...imageProps } = getImageProps(props).props;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- alt comes from the props above.
  return <img {...imageProps} />;
}
