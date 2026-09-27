import { render } from 'preact';
import { AppProvider } from '../ui/app-context';
import { OptionsApp } from './OptionsApp';
import './options.css';

render(
  <AppProvider>
    <OptionsApp />
  </AppProvider>,
  document.getElementById('app')!,
);
