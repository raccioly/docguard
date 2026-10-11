package warehouse

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

type JobID uint64

// Job is a unit of recurring background work, such as a nightly stock count.
type Job struct {
	ID       JobID
	Name     string
	Interval time.Duration
	Timeout  time.Duration
	Run      func(ctx context.Context) error
}

type JobResult struct {
	ID       JobID
	Started  time.Time
	Duration time.Duration
	Err      error
}

// Scheduler runs each registered job on its own ticker.
type Scheduler struct {
	mu       sync.Mutex
	nextID   JobID
	jobs     map[JobID]*Job
	results  chan JobResult
	stop     chan struct{}
	stopOnce sync.Once
	wg       sync.WaitGroup
	logger   *log.Logger
}

func NewScheduler(logger *log.Logger, buffer int) *Scheduler {
	return &Scheduler{
		jobs:    make(map[JobID]*Job),
		results: make(chan JobResult, buffer),
		stop:    make(chan struct{}),
		logger:  logger,
	}
}

// Add registers a job. A zero timeout defaults to the job's interval.
func (s *Scheduler) Add(
	name string,
	every, timeout time.Duration,
	run func(ctx context.Context) error,
) JobID {
	s.mu.Lock()
	defer s.mu.Unlock()
	if timeout == 0 {
		timeout = every
	}
	s.nextID++
	s.jobs[s.nextID] = &Job{ID: s.nextID, Name: name, Interval: every, Timeout: timeout, Run: run}
	return s.nextID
}

// Results exposes completed runs; the channel is never closed.
func (s *Scheduler) Results() <-chan JobResult { return s.results }

func (s *Scheduler) Start(ctx context.Context) {
	s.mu.Lock()
	jobs := make([]*Job, 0, len(s.jobs))
	for _, j := range s.jobs {
		jobs = append(jobs, j)
	}
	s.mu.Unlock()

	for _, j := range jobs {
		s.wg.Add(1)
		go func(j *Job) {
			defer s.wg.Done()
			s.loop(ctx, j)
		}(j)
	}
}

func (s *Scheduler) loop(ctx context.Context, j *Job) {
	ticker := time.NewTicker(j.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stop:
			return
		case t := <-ticker.C:
			res := s.runOnce(ctx, j, t)
			select {
			case s.results <- res:
			default:
				s.logger.Printf("dropping result for job %d (%s): buffer full", j.ID, j.Name)
			}
		}
	}
}

// runOnce executes a job with its timeout and converts a panic into an error,
// so one misbehaving job cannot take the whole scheduler down.
func (s *Scheduler) runOnce(parent context.Context, j *Job, started time.Time) (res JobResult) {
	res = JobResult{ID: j.ID, Started: started}
	ctx, cancel := context.WithTimeout(parent, j.Timeout)
	defer cancel()
	defer func() {
		res.Duration = time.Since(started)
		if r := recover(); r != nil {
			res.Err = fmt.Errorf("job %s panicked: %v", j.Name, r)
		}
	}()
	res.Err = j.Run(ctx)
	return res
}

// Stop signals every loop and waits up to timeout for them to return.
func (s *Scheduler) Stop(timeout time.Duration) error {
	s.stopOnce.Do(func() { close(s.stop) })
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-time.After(timeout):
		return fmt.Errorf("scheduler: jobs still running after %s", timeout)
	}
}

// Retry runs fn until it succeeds, attempts are exhausted, or ctx ends.
// Delays grow as {base, 2*base, 4*base, ...} and never exceed ceiling.
func Retry(
	ctx context.Context,
	attempts int,
	base, ceiling time.Duration,
	fn func(attempt int) error,
) error {
	var last error
	delay := base
attempt:
	for i := 1; i <= attempts; i++ {
		if last = fn(i); last == nil {
			return nil
		}
		if i == attempts {
			break attempt
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return errors.Join(last, ctx.Err())
		case <-timer.C:
		}
		if delay *= 2; delay > ceiling {
			delay = ceiling
		}
	}
	return fmt.Errorf("retry: %w", last)
}

// ParallelMap applies fn to every input using n workers and preserves the
// input order in the output. The first error stops feeding new inputs.
func ParallelMap[In, Out any](
	ctx context.Context,
	n int,
	inputs []In,
	fn func(context.Context, In) (Out, error),
) ([]Out, error) {
	type task struct {
		idx int
		in  In
	}
	tasks := make(chan task)
	errs := make(chan error, n)
	out := make([]Out, len(inputs))

	var wg sync.WaitGroup
	for w := 0; w < n; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range tasks {
				v, err := fn(ctx, t.in)
				if err != nil {
					errs <- fmt.Errorf("item %d: %w", t.idx, err)
					return
				}
				out[t.idx] = v
			}
		}()
	}

	var firstErr error
feed:
	for i, in := range inputs {
		select {
		case tasks <- task{idx: i, in: in}:
		case firstErr = <-errs:
			break feed
		case <-ctx.Done():
			firstErr = ctx.Err()
			break feed
		}
	}
	close(tasks)
	wg.Wait()
	close(errs)
	if firstErr == nil {
		firstErr = <-errs
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}
