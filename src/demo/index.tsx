import React, { useCallback } from 'react';
import { render } from 'react-dom';
import { Uq, useUq } from '..';

const Progress = ({ active, progress }: { readonly active: boolean; readonly progress: number }) => {
    if (!active) return null;

    return (
        <progress value={progress} max={1} title={progress.toLocaleString([], { style: 'percent' })}>
            {progress.toLocaleString([], { style: 'percent' })}
        </progress>
    );
};

const Status = ({ status, progress }: Uq.Item) => {
    return <>{status !== Uq.Status.Ongoing ? Uq.Status[status] : progress.toLocaleString([], { style: 'percent' })}</>;
};

const Actions = ({ uq, id, status }: { readonly uq: Uq; readonly id: number; readonly status: Uq.Status }) => {
    const handleAbort = useCallback(() => {
        uq.abort(id);
    }, [uq, id]);

    const handleRemove = useCallback(() => {
        uq.remove(id);
    }, [uq, id]);

    const handleRetry = useCallback(() => {
        uq.retry(id);
    }, [uq, id]);

    return (
        <>
            {status & Uq.Status.Unfinished ? <button onClick={handleAbort}>Abort</button> : null}
            <button onClick={handleRemove}>Remove</button>
            {status & Uq.Status.Failed ? <button onClick={handleRetry}>Retry</button> : null}
        </>
    );
};

const App = () => {
    const [items, progress, active, uq] = useUq({ concurrency: 1 });

    return (
        <section>
            <h1>Uploads</h1>
            <div>
                <Progress active={active} progress={progress} />
            </div>
            <div>
                <input
                    type='file'
                    multiple
                    onChange={({ target }) => {
                        if (!target.files) return;

                        for (const file of target.files) {
                            uq.push(file, 'http://localhost:1488/');
                        }
                    }}
                />
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Name</th>
                        <th>Size</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map(item => (
                        <tr key={item.id}>
                            <td>
                                <Status {...item} />
                            </td>
                            <td>{item.file.name}</td>
                            <td>{item.file.size}</td>
                            <td>
                                <Actions uq={uq!} id={item.id} status={item.status} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
};

render(<App />, document.querySelector('#root')!);
