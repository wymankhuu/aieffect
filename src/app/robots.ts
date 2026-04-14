import type { MetadataRoute } from "next";

// Block all crawlers — game content is ephemeral and not meant to be indexed
// or used for AI training. Listing the major AI crawlers explicitly so they
// can't claim ambiguity about the wildcard rule.
const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Omgili",
  "Omgilibot",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", disallow: "/" },
      ...AI_BOTS.map((userAgent) => ({ userAgent, disallow: "/" })),
    ],
  };
}
