import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ClusterGraph from './ClusterGraph';

describe('ClusterGraph', () => {
  it('renders empty state without data', () => {
    render(<ClusterGraph data={null} />);
    expect(screen.getByText('No cluster data available')).toBeInTheDocument();
  });
});

