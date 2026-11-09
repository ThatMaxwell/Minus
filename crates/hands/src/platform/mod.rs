//! One worker thread per process owns the OS accessibility objects (they're tied to the
//! thread that created them on some systems), and everyone else talks to it through a channel.

#[cfg(windows)]
mod windows;

use crate::{ActResult, Action, HandsError, Result, Snapshot, SnapshotOptions, Target, WindowInfo};
use std::sync::mpsc::{channel, Sender};

pub(crate) trait Backend {
    fn windows(&mut self) -> Result<Vec<WindowInfo>>;
    fn snapshot(&mut self, target: Target, opts: SnapshotOptions) -> Result<Snapshot>;
    fn act(&mut self, actions: Vec<Action>, keep_going: bool) -> Result<Vec<ActResult>>;
    fn screenshot(&mut self) -> Result<Vec<u8>>;
}

enum Req {
    Windows(Sender<Result<Vec<WindowInfo>>>),
    Snapshot(Target, SnapshotOptions, Sender<Result<Snapshot>>),
    Act(Vec<Action>, bool, Sender<Result<Vec<ActResult>>>),
    Screenshot(Sender<Result<Vec<u8>>>),
}

#[derive(Clone)]
pub(crate) struct Worker {
    tx: Sender<Req>,
}

fn make() -> Result<Box<dyn Backend>> {
    #[cfg(windows)]
    {
        return windows::Uia::new().map(|b| Box::new(b) as Box<dyn Backend>);
    }
    #[allow(unreachable_code)]
    Err(HandsError::Unsupported(std::env::consts::OS))
}

fn gone() -> HandsError {
    HandsError::Os("the Hands worker stopped".into())
}

impl Worker {
    pub fn start() -> Result<Self> {
        let (tx, rx) = channel::<Req>();
        let (ready_tx, ready_rx) = channel::<Result<()>>();
        std::thread::Builder::new()
            .name("minus-hands".into())
            .spawn(move || {
                let mut b = match make() {
                    Ok(b) => {
                        let _ = ready_tx.send(Ok(()));
                        b
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                for req in rx {
                    match req {
                        Req::Windows(r) => { let _ = r.send(b.windows()); }
                        Req::Snapshot(t, o, r) => { let _ = r.send(b.snapshot(t, o)); }
                        Req::Act(a, k, r) => { let _ = r.send(b.act(a, k)); }
                        Req::Screenshot(r) => { let _ = r.send(b.screenshot()); }
                    }
                }
            })
            .map_err(|e| HandsError::Os(e.to_string()))?;
        ready_rx.recv().map_err(|_| gone())??;
        Ok(Self { tx })
    }

    fn ask<T>(&self, make: impl FnOnce(Sender<Result<T>>) -> Req) -> Result<T> {
        let (tx, rx) = channel();
        self.tx.send(make(tx)).map_err(|_| gone())?;
        rx.recv().map_err(|_| gone())?
    }
    pub fn windows(&self) -> Result<Vec<WindowInfo>> {
        self.ask(Req::Windows)
    }
    pub fn snapshot(&self, t: Target, o: SnapshotOptions) -> Result<Snapshot> {
        self.ask(|r| Req::Snapshot(t, o, r))
    }
    pub fn act(&self, a: Vec<Action>, keep_going: bool) -> Result<Vec<ActResult>> {
        self.ask(|r| Req::Act(a, keep_going, r))
    }
    pub fn screenshot(&self) -> Result<Vec<u8>> {
        self.ask(Req::Screenshot)
    }
}
