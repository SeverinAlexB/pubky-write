import { lazy, Suspense, useState, type ComponentType } from "react";

export type LazyComponent<P> = ComponentType<P> & { preload: () => Promise<unknown> };

/**
 * A component whose code is in its own chunk, loaded on first render or by `preload()`.
 * Mounted once loaded, it renders directly. Through React.lazy alone each first render would suspend,
 * and React holds back revealing suspended content for about 300 ms. Until the chunk has
 * loaded nothing is drawn, so it suits overlays such as dialogs and popovers.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): LazyComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (loading ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        // Let a later render try again, for example after a network error.
        loading = null;
        throw error;
      },
    ));
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  const Component = (props: P) => {
    // Decided once per mount: going from the lazy element to the loaded one when the code arrives
    // would mount the component again and lose its state (a dialog opened before the preload).
    const [Loaded] = useState(() => loaded);
    if (Loaded) return <Loaded {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
  return Object.assign(Component, { preload });
}
