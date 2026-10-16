import { useEffect } from 'react';

/**
 * Page title, description and indexing for search engines. index.html carries the landing page's
 * English values for crawlers that do not run scripts; here they follow the page and language.
 * Only the public landing page is indexed: the app and the sign-in pages ask for `noindex`.
 */
function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

export function usePageMeta({ title, description, index }: { title: string; description?: string; index: boolean }) {
  useEffect(() => {
    document.title = title;
    if (description) setMeta('description', description);
    setMeta('robots', index ? 'index, follow' : 'noindex, nofollow');
  }, [title, description, index]);
}
