// Cooperative job scheduler for the nightly batch runner. Jobs run on the
// caller's thread from run_due(), earliest due time first.

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <functional>
#include <iostream>
#include <memory>
#include <queue>
#include <string>
#include <unordered_map>
#include <vector>

namespace ops {
namespace scheduling {

using Clock = std::chrono::steady_clock;
using TimePoint = Clock::time_point;

template <typename T>
using Owned = std::unique_ptr<T>;

enum class Priority : std::uint8_t { Low, Normal, High };
enum class JobState { Pending, Running, Succeeded, Failed, Cancelled };

struct JobId {
    std::uint64_t value = 0;

    constexpr bool operator==(const JobId &other) const noexcept { return value == other.value; }
};

} // namespace scheduling
} // namespace ops

namespace std {
template <>
struct hash<ops::scheduling::JobId> {
    size_t operator()(const ops::scheduling::JobId &id) const noexcept
    {
        return hash<uint64_t>{}(id.value);
    }
};
} // namespace std

namespace ops::scheduling {

using namespace std::chrono_literals;

class Job {
public:
    Job(std::string name, Priority priority) noexcept
        : name_(std::move(name)), priority_(priority)
    {
    }
    virtual ~Job() = default;

    [[nodiscard]] const std::string &name() const noexcept { return name_; }
    [[nodiscard]] Priority priority() const noexcept { return priority_; }
    [[nodiscard]] JobState state() const noexcept { return state_; }

    JobState execute();
    virtual void cancel() { state_ = JobState::Cancelled; }

protected:
    virtual bool run() = 0;
    virtual void on_failure(const std::exception &error)
    {
        std::cerr << "job " << name_ << " failed: " << error.what() << '\n';
    }

private:
    std::string name_;
    Priority priority_;
    JobState state_ = JobState::Pending;
};

JobState Job::execute()
{
    if (state_ != JobState::Pending) {
        return state_;
    }
    state_ = JobState::Running;
    try {
        state_ = run() ? JobState::Succeeded : JobState::Failed;
    } catch (const std::exception &error) {
        on_failure(error);
        state_ = JobState::Failed;
    }
    return state_;
}

class CallbackJob final : public Job {
public:
    using Body = std::function<bool()>;

    CallbackJob(std::string name, Priority priority, Body body)
        : Job(std::move(name), priority), body_(std::move(body))
    {
    }

    void cancel() override
    {
        body_ = nullptr;
        Job::cancel();
    }

private:
    bool run() override { return body_ && body_(); }

    Body body_;
};

class Scheduler {
public:
    struct Options {
        std::size_t max_batch = 32;
        std::chrono::milliseconds slow_job_threshold = 250ms;
    };

    Scheduler() : Scheduler(Options{}) {}
    explicit Scheduler(Options options) : options_(options) {}
    Scheduler(const Scheduler &) = delete;
    Scheduler &operator=(const Scheduler &) = delete;
    ~Scheduler();

    JobId submit(Owned<Job> job, TimePoint due = Clock::now());
    std::size_t run_due(TimePoint now = Clock::now());
    [[nodiscard]] std::size_t pending() const noexcept { return slots_.size(); }

private:
    struct Slot {
        Owned<Job> job;
        TimePoint due;
        JobId id;
    };

    struct LaterFirst {
        bool operator()(const Slot *a, const Slot *b) const noexcept
        {
            return a->due != b->due ? a->due > b->due : a->id.value > b->id.value;
        }
    };

    Options options_;
    std::uint64_t next_id_ = 1;
    std::unordered_map<JobId, Slot> slots_;
    std::priority_queue<Slot *, std::vector<Slot *>, LaterFirst> queue_;
};

Scheduler::~Scheduler()
{
    for (auto &[id, slot] : slots_) {
        slot.job->cancel();
    }
}

JobId Scheduler::submit(Owned<Job> job, TimePoint due)
{
    if (!job) {
        return JobId{};
    }
    const JobId id{next_id_++};
    auto [it, inserted] = slots_.emplace(id, Slot{std::move(job), due, id});
    queue_.push(&it->second);
    return inserted ? id : JobId{};
}

std::size_t Scheduler::run_due(TimePoint now)
{
    std::vector<Slot *> batch;
    while (!queue_.empty() && batch.size() < options_.max_batch && queue_.top()->due <= now) {
        batch.push_back(queue_.top());
        queue_.pop();
    }
    std::stable_sort(batch.begin(), batch.end(), [](const Slot *a, const Slot *b) {
        return a->job->priority() > b->job->priority();
    });

    std::size_t succeeded = 0;
    for (Slot *slot : batch) {
        const auto started = Clock::now();
        if (slot->job->execute() == JobState::Succeeded) {
            ++succeeded;
        }
        if (auto took = Clock::now() - started; took > options_.slow_job_threshold) {
            std::clog << "slow job " << slot->job->name() << ": "
                      << std::chrono::duration_cast<std::chrono::milliseconds>(took).count() << "ms\n";
        }
        slots_.erase(JobId{slot->id});
    }
    return succeeded;
}

void register_nightly_jobs(Scheduler &scheduler, const std::vector<std::string> &regions)
{
    const auto start = Clock::now() + 5min;
    std::size_t offset = 0;
    for (const auto &region : regions) {
        auto body = [region, &scheduler] {
            std::clog << "reconciling " << region << " (" << scheduler.pending() << " queued)\n";
            return true;
        };
        scheduler.submit(std::make_unique<CallbackJob>("reconcile-" + region, Priority::High, body),
                         start + std::chrono::seconds(30 * offset++));
    }

    auto attempts = std::make_shared<int>(0);
    scheduler.submit(std::make_unique<CallbackJob>(
        "compact-ledger", Priority::Low, [attempts] { return ++*attempts >= 3; }));
}

} // namespace ops::scheduling
