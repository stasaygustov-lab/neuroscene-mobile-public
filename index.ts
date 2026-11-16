import * as React from 'react';
import { registerRootComponent } from 'expo';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

declare const require: (moduleName: string) => { default: React.ComponentType<any> };

type StartupBoundaryState = {
  error: unknown | null;
};

class StartupErrorBoundary extends React.Component<
  React.PropsWithChildren<{}>,
  StartupBoundaryState
> {
  state: StartupBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): StartupBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[NeuroScene] Fatal UI render error', error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      const error = this.state.error;
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';

      return React.createElement(
        View,
        { style: styles.root },
        React.createElement(Text, { style: styles.brand }, 'НейроСцена'),
        React.createElement(Text, { style: styles.title }, 'Не удалось открыть интерфейс'),
        React.createElement(
          Text,
          { style: styles.description },
          'Приложение перехватило ошибку запуска вместо пустого экрана. Текст ошибки сохранён в журнале Android.'
        ),
        React.createElement(
          ScrollView,
          { style: styles.errorPanel, contentContainerStyle: styles.errorPanelContent },
          React.createElement(Text, { selectable: true, style: styles.errorText }, message),
          stack
            ? React.createElement(Text, { selectable: true, style: styles.stackText }, stack)
            : null
        )
      );
    }

    return this.props.children;
  }
}

// Resolve App only after the boundary mounts so module initialization failures
// in App.tsx can be rendered as a readable startup diagnostic.
function AppLoader() {
  const App = require('./App').default;
  return React.createElement(App);
}

function Root() {
  return React.createElement(
    StartupErrorBoundary,
    null,
    React.createElement(AppLoader)
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#030817',
    paddingHorizontal: 22,
    paddingTop: 72,
    paddingBottom: 24,
  },
  brand: {
    color: '#69BFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 28,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
  },
  description: {
    color: '#B8CBE2',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  errorPanel: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#285B91',
    backgroundColor: '#071A34',
  },
  errorPanelContent: {
    padding: 14,
  },
  errorText: {
    color: '#FFB4B4',
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  stackText: {
    color: '#B8CBE2',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
  },
});

registerRootComponent(Root);
